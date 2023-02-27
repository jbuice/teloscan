import functions_overrides from 'src/lib/abi/signature/functions_signatures_overrides.json';
import events_overrides from 'src/lib/abi/signature/events_signatures_overrides.json';
import { TRANSFER_SIGNATURES } from 'src/lib/abi/signature/transfer_signatures';
import { ethers } from 'ethers';

export default class FragmentParser {
    constructor(evmEndpoint) {
        this.functionInterfaces = functions_overrides;
        this.eventInterfaces = events_overrides;
        this.evmEndpoint = evmEndpoint;
    }

    async addEventInterface(hex, signature){
        if (Object.prototype.hasOwnProperty.call(this.eventInterfaces, hex)) {
            return;
        }
        this.eventInterfaces[hex] = signature;
    }
    async addFunctionInterface(hex, signature){
        if (Object.prototype.hasOwnProperty.call(this.functionInterfaces, hex)) {
            return;
        }
        this.functionInterfaces[hex] = signature;
    }

    async getFunctionInterface(data) {
        let prefix = data.toLowerCase().slice(0, 10);
        if(prefix === '0x'){
            return;
        }
        if (Object.prototype.hasOwnProperty.call(this.functionInterfaces, prefix)) {
            return new ethers.utils.Interface([this.functionInterfaces[prefix]]);
        }

        try {
            const abiResponse = await this.evmEndpoint.get(`/v2/evm/get_abi_signature?type=function&hex=${prefix}`);
            if (abiResponse) {
                if (!abiResponse.data || !abiResponse.data.text_signature || abiResponse.data.text_signature === '') {
                    console.error(`Unable to find function signature for sig: ${prefix}`);
                    return;
                }
                this.functionInterfaces[prefix] = `function ${abiResponse.data.text_signature}`;
                return new ethers.utils.Interface([this.functionInterfaces[prefix]]);
            }
        } catch (e) {
            console.error(`Error trying to find event signature for function ${prefix}`);
            return;
        }
    }
    async getEventInterface(data) {
        let prefix = data.toLowerCase().slice(0, 10);
        if (Object.prototype.hasOwnProperty.call(this.eventInterfaces, prefix)) {
            return new ethers.utils.Interface([this.eventInterfaces[prefix]]);
        }
        if(data === '0x'){
            return;
        }
        try {
            const abiResponse = await this.evmEndpoint.get(`/v2/evm/get_abi_signature?type=event&hex=${data}`);
            if (abiResponse) {
                if (!abiResponse.data || !abiResponse.data.text_signature || abiResponse.data.text_signature === '') {
                    console.error(`Unable to find event signature for event: ${data}`);
                    return;
                }

                this.eventInterfaces[data] = `event ${abiResponse.data.text_signature}`;
                return new ethers.utils.Interface([this.eventInterfaces[data]]);
            }
        } catch (e) {
            console.error(`Error trying to find event signature for event ${data}: ${e.message}`);
            return;
        }
    }

    formatLog(contract, log, parsedLog){
        if(!parsedLog.signature){
            return log;
        }
        parsedLog.function_signature = log.topics[0].substr(0, 10);
        parsedLog.isTransfer = TRANSFER_SIGNATURES.includes(parsedLog.function_signature);
        parsedLog.logIndex = log.logIndex;
        parsedLog.address = log.address;
        parsedLog.contract = contract;
        parsedLog.name = parsedLog.signature;
        return parsedLog;
    }

    async parseLog(log, contract) {
        if (contract.getInterface()) {
            let parsedLog;
            try {
                parsedLog = contract.getInterface().parseLog(log);
            } catch (e) {
                parsedLog = await this.parseEvent(contract, log);
            }
            parsedLog = this.formatLog(contract, log, parsedLog);
            if(parsedLog.name && parsedLog.eventFragment?.inputs){
                parsedLog.inputs = parsedLog.eventFragment.inputs;
            }
            return parsedLog;
        }

        let parsedLog = await this.parseEvent(contract, log);
        parsedLog = this.formatLog(contract, log, parsedLog);
        if(parsedLog.name && parsedLog.eventFragment?.inputs){
            parsedLog.inputs = parsedLog.eventFragment.inputs;
        }
        parsedLog = this.formatLog(contract, log, parsedLog);
        return parsedLog;
    }

    async parseEvent(contract, log){
        const eventIface = await this.getEventInterface(log.topics[0]);
        if (eventIface) {
            try {
                let parsedLog = eventIface.parseLog(log);
                return parsedLog;
            } catch(e) {
                console.log(`Failed to parse log #${log.logIndex} from event interface: ${e.message}`);
            }
        }
        log.function_signature = log.topics[0]?.substr(0, 10);
        return log;
    }
}