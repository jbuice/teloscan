import ContractFactory from 'src/lib/contract/ContractFactory';
import { ethers } from 'ethers';
import axios from 'axios';
import { getTopicHash } from 'src/lib/utils';
import { ERC1155_TRANSFER_SIGNATURE, TRANSFER_SIGNATURES } from 'src/lib/abi/signature/transfer_signatures.js';
import { erc721MetadataAbi } from 'src/lib/abi';

const tokenList = 'https://raw.githubusercontent.com/telosnetwork/token-list/main/telosevm.tokenlist.json';
const systemContractList = 'https://raw.githubusercontent.com/telosnetwork/token-list/main/telosevm.systemcontractlist.json';

export default class ContractManager {
    constructor(indexerApi, parser) {
        this.contracts = {};
        this.processing = [];
        this.parser = parser;
        this.factory = new ContractFactory();
        this.indexerApi = indexerApi;
        this.systemContractList = false;
        this.tokenList = false;
        this.ethersProvider = new ethers.providers.JsonRpcProvider(process.env.NETWORK_EVM_RPC);
    }

    getEthersProvider() {
        return this.ethersProvider;
    }

    async getTransfers(raw) {
        if (!raw.logs || raw.logs?.length === 0) {
            return [];
        }
        const logs = (typeof raw.logs === 'string') ? JSON.parse(raw.logs) : raw.logs;
        const promises = logs.map(async (log) => {
            const sig = log.topics[0].slice(0, 10);
            if (TRANSFER_SIGNATURES.includes(sig)) {
                const contract = await this.getContract(log.address);
                if (contract && contract.supportedInterfaces.includes('erc20')) {
                    return {
                        index: log.logIndex,
                        address: contract.address,
                        value: log.data,
                        decimal: contract.properties?.decimals,
                        to: getTopicHash(log.topics[1]),
                        from: getTopicHash(log.topics[2]),
                        symbol: contract.properties?.symbol,
                    };
                }
            }
            return null;
        });

        const transfers = (await Promise.all(promises)).filter(Boolean);
        transfers.sort((a, b) => a.index - b.index);
        return transfers;
    }

    async parseContractTransaction(raw, data, contract, transfers) {
        if (data === '0x' || data === null || typeof contract === 'undefined') {
            return false;
        }
        if (contract.getInterface()) {
            try {
                const transaction = await contract.getInterface().parseTransaction({ data });
                if (!transfers) {
                    return transaction;
                }
                transaction.transfers = await this.getTransfers(raw);
                return transaction;
            } catch (e) {
                console.error(`Failed to parse transaction data ${data} using abi for ${contract.address}: ${e}`);
            }
        }
        try {
            const functionIface = await this.parser.getFunctionInterface(data);
            if (functionIface) {
                const transaction = functionIface.parseTransaction({ data });
                if (!transfers) {
                    return transaction;
                }
                transaction.transfers = await this.getTransfers(raw);
                return transaction;
            }
        } catch (e) {
            console.info(`Failed to parse transaction data using abi for ${contract.address}: ${e}`);
        }
        return false;
    }

    async loadNFTs(contract) {
        const address = contract.address.toLowerCase();
        try {
            const response = await this.indexerApi.get(`/contract/${address}/nfts`);
            if (response.data.results?.length > 0) {
                for (let i = 0; i < response.data.results.length; i++) {
                    const nft = response.data.results[i];
                    this.contracts[address].nfts[nft.tokenId] = nft;
                }
                return response.data.results;
            }
        } catch (e) {
            console.info(`Could not load NFTs for ${address} from indexer: ${e.message}`);
        }
        return [];
    }

    async loadNFT(contract, tokenId) {
        const address = contract.address.toLowerCase();
        if (!this.contracts[address]) {
            this.contracts[address] = { nfts: [] };
        } else if (this.contracts[address].nfts[tokenId]) {
            return this.contracts[address].nfts[tokenId];
        }
        try {
            // TODO: change endpoint based on contract interfaces
            const response = await this.indexerApi.get(`/contract/${address}/nfts?tokenId=${tokenId}`);
            if (response.data.results?.length > 0) {
                [this.contracts[address].nfts[tokenId]] = response.data.results;
                return response.data.results[0];
            }
            console.info(`Could load NFT #${tokenId} for ${address} from indexer: no NFT found. Trying fallback...`);
        } catch (e) {
            console.info(`Could load NFT #${tokenId} for ${address} from indexer: ${e.message}, trying fallback...`);
        }

        // If indexer call failed, try a direct RPC call
        // This is to account for possible lag in indexing NFTs
        try {
            const contractInstance = await this.getContractFromAbi(contract.address, erc721MetadataAbi);
            const tokenURI = await contractInstance.tokenURI(tokenId);
            this.contracts[address].nfts[tokenId] = {
                id: tokenId,
                tokenUri: tokenURI,
                metadata: null,
                imageCache: null,
            };
            return this.contracts[address].nfts[tokenId];
        } catch (e) {
            console.error(`Could load NFT #${tokenId} for ${address} from fallback RPC calls: ${e.message}`);
        }

        return null;
    }

    getTokenTypeFromLog(log) {
        const sig = log.topics[0].substr(0, 10);
        const type = (log.topics.length === 4) ? 'erc721' : 'erc20';
        return (sig === ERC1155_TRANSFER_SIGNATURE) ? 'erc1155' : type;
    }

    addContractToCache(address, contractData) {
        if (!address) {
            return;
        }
        const index = address.toString().toLowerCase();
        const contract = this.factory.buildContract(contractData);
        if (
            typeof this.contracts[index] === 'undefined'
            || (contract.abi?.length > 0 && !this.contracts[index].abi)
            || (contract.abi?.length > 0 && contract.abi.length > this.contracts[index].abi?.length)
        ) {
            this.contracts[index] = contract;
        }
    }

    addContractsToCache(contracts) {
        Object.keys(contracts).forEach((index) => {
            if (Object.prototype.hasOwnProperty.call(contracts, index)) {
                this.addContractToCache(index, contracts[index]);
            }
        });
    }

    async loadTokenList() {
        const results = await axios.get(tokenList);
        const { tokens } = results.data;
        results.data.tokens = (tokens ?? []).filter(({ chainId }) => chainId === process.env.NETWORK_EVM_CHAIN_ID);

        this.tokenList = results.data || false;
    }

    async getSystemContractsList() {
        if (!this.systemContractList) {
            if (!this.processing.systemcontractlist) {
                this.processing.systemcontractlist = true;
                const results = await axios.get(systemContractList);
                const { contracts } = results.data;
                results.data.contracts = (contracts ?? []).filter(
                    ({ chainId }) => chainId === process.env.NETWORK_EVM_CHAIN_ID,
                );
                this.systemContractList = results.data || false;
                this.processing.systemcontractlist = false;
            } else {
                await new Promise((resolve) => {
                    setTimeout(resolve, 300);
                });
                return this.getSystemContractsList();
            }
        }
        return this.systemContractList;
    }

    async getTokenList() {
        if (!this.tokenList) {
            if (!this.processing.tokenlist) {
                this.processing.tokenlist = true;
                await this.loadTokenList();
                this.processing.tokenlist = false;
            } else {
                await new Promise((resolve) => {
                    setTimeout(resolve, 300);
                });
                return this.getTokenList();
            }
        }
        return this.tokenList;
    }

    getContractInstance(contract, provider) {
        if (!contract.abi) {
            console.error('Cannot create contract instance without ABI !');
            return false;
        }

        return new ethers.Contract(contract.address, contract.abi, provider || this.getEthersProvider());
    }

    async getCachedContract(address) {
        if (address === null || typeof address !== 'string') {
            return null;
        }
        const addressLower = address.toLowerCase();
        if (this.contracts[addressLower]) {
            return this.contracts[addressLower];
        }
        return null;
    }

    async getContract(address, cacheEmpty) {
        if (address === null || typeof address !== 'string') {
            return null;
        }
        const addressLower = address.toLowerCase();

        if (typeof this.contracts[addressLower] !== 'undefined') {
            return this.contracts[addressLower];
        }

        if (this.processing.includes(addressLower)) {
            await new Promise((resolve) => {
                setTimeout(resolve, 300);
            });
            return this.getContract(address);
        }

        this.processing.push(addressLower);
        let contract = (cacheEmpty) ? { address } : null;
        try {
            const response = await this.indexerApi.get(`/contract/${address}?full=true&includeAbi=true`);
            if (response.data?.success && response.data.results.length > 0) {
                [contract] = response.data.results;
            }
        } catch (e) {
            console.error(`Could not retrieve contract ${address}: ${e.message}`);
        }
        if (contract === null) {
            return null;
        }
        this.addContractToCache(address, contract);
        const index = this.processing.indexOf(addressLower);
        if (index > -1) {
            this.processing.splice(index, 1);
        }
        return this.factory.buildContract(contract);
    }

    async getContractFromAbi(address, abi) {
        return new ethers.Contract(address, abi, this.getEthersProvider());
    }
}
