import type { Plugin } from "vite";

/** Nøglerne, et produktionsbyg ikke kan undvære. */
export declare const NOEGLER: readonly string[];

/** Stopper et produktionsbyg, hvis en af nøglerne mangler i .env.local. */
export declare function kraevNoegler(): Plugin;
