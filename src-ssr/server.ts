/**
 * More info about this file:
 * https://v2.quasar.dev/quasar-cli-vite/developing-ssr/ssr-webserver
 *
 * Runs in Node context.
 */

/**
 * Make sure to yarn add / npm install (in your project root)
 * anything you import here (except for express and compression).
 */
import { Hono } from 'hono';
import express from 'express';
import { serve } from '@hono/node-server'
import { compress } from 'hono/compress';
import { handle } from 'hono/cloudflare-pages';

import {
    ssrClose,
    ssrCreate,
    ssrListen,
    ssrRenderPreloadTag,
    ssrServeStaticContent,
} from 'quasar/wrappers';

/**
 * Create your webserver and return its instance.
 * If needed, prepare your webserver to receive
 * connect-like middlewares.
 *
 * Should NOT be async!
 */
export const create = ssrCreate((/* { ... } */) => {
    const app = process.env.PROD ? new Hono() : express();

    // place here any middlewares that
    // absolutely need to run before anything else
    if (process.env.PROD) {
        (app as Hono).use('*', compress());
    }

    return app;
});

/**
 * You need to make the server listen to the indicated port
 * and return the listening instance or whatever you need to
 * close the server with.
 *
 * The "listenResult" param for the "close()" definition below
 * is what you return here.
 *
 * For production, you can instead export your
 * handler for serverless use or whatever else fits your needs.
 */
export const listen = ssrListen(async ({app, port, isReady }) => {
    await isReady();
    if (!process.env.PROD) {
        return app.listen(port, () => {
            console.log('Server listening at port ' + port);
        });        /*
        serve({
            fetch: (hono as Hono).fetch,
            port: port
        }, (info) => {
            console.log(`Listening on http://localhost:${info.port}`);
        })
         */
    }

    const hono = app as unknown;
    const onRequest = handle(hono as Hono);
    return onRequest;
});

/**
 * Should close the server and free up any resources.
 * Will be used on development only when the server needs
 * to be rebooted.
 *
 * Should you need the result of the "listen()" call above,
 * you can use the "listenResult" param.
 *
 * Can be async.
 */
export const close = ssrClose(({ listenResult }) => listenResult.close());


const maxAge = process.env.DEV ? 0 : 1000 * 60 * 60 * 24 * 30;

/**
 * Should return middleware that serves the indicated path
 * with static content.
 */
export const serveStaticContent = ssrServeStaticContent((path, opts) => {
    return express.static(path, {
        maxAge,
        ...opts,
    });
});

const jsRE = /\.js$/;
const cssRE = /\.css$/;
const woffRE = /\.woff$/;
const woff2RE = /\.woff2$/;
const gifRE = /\.gif$/;
const jpgRE = /\.jpe?g$/;
const pngRE = /\.png$/;

/**
 * Should return a String with HTML output
 * (if any) for preloading indicated file
 */
export const renderPreloadTag = ssrRenderPreloadTag((file) => {
    if (jsRE.test(file) === true) {
        return `<link rel="modulepreload" href="${file}" crossorigin>`;
    }

    if (cssRE.test(file) === true) {
        return `<link rel="stylesheet" href="${file}">`;
    }

    if (woffRE.test(file) === true) {
        return `<link rel="preload" href="${file}" as="font" type="font/woff" crossorigin>`;
    }

    if (woff2RE.test(file) === true) {
        return `<link rel="preload" href="${file}" as="font" type="font/woff2" crossorigin>`;
    }

    if (gifRE.test(file) === true) {
        return `<link rel="preload" href="${file}" as="image" type="image/gif">`;
    }

    if (jpgRE.test(file) === true) {
        return `<link rel="preload" href="${file}" as="image" type="image/jpeg">`;
    }

    if (pngRE.test(file) === true) {
        return `<link rel="preload" href="${file}" as="image" type="image/png">`;
    }

    return '';
});
