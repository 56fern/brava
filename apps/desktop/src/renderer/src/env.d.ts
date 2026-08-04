/// <reference types="vite/client" />
import type { BravaApi } from "../../shared/types";
declare global { interface Window { brava: BravaApi } }
export {};

