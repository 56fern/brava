import type { WebContents } from "electron";
import type { CartDebugState } from "../shared/cart-debug.js";
import { permitsCartDebugUrl } from "../shared/cart-debug.js";
import type { CartTestOptions, CheckoutOutcome } from "./checkout-automation.js";

export type CartDebugRunOptions = CartTestOptions & { ready: (contents: WebContents) => void };

/** One opt-in diagnostic run. Frames stay in RAM; no profile/card is loaded. */
export class CartDebugController {
  private value: CartDebugState = { running: false, message: "Ready for a cart-only test.", snapshots: [] };
  private controller?: AbortController;
  private job?: Promise<void>;

  state(): CartDebugState { return this.value; }

  start(taskId: string, run: (signal: AbortSignal, options: CartDebugRunOptions) => Promise<CheckoutOutcome>): CartDebugState {
    if (this.value.running) throw new Error("Stop the current cart test first.");
    const controller = new AbortController();
    this.controller = controller;
    this.value = { taskId, running: true, message: "Opening a fresh hidden session…", snapshots: [] };
    let contents: WebContents | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let revision = 0;
    let capturing = false;
    let pendingCapture = Promise.resolve();
    const navigated = () => { revision += 1; };
    const takeFrame = async (label: string, milestone = false) => {
      if (capturing || controller.signal.aborted || !contents || contents.isDestroyed()) return;
      const url = contents.getURL();
      if (!permitsCartDebugUrl(url)) return;
      capturing = true;
      const before = revision;
      let captureTimeout: ReturnType<typeof setTimeout> | undefined;
      let cancelCapture = () => {};
      try {
        const image = await Promise.race([
          (async () => {
            // A fully hidden Chromium surface can return its previous paint
            // on the first capture. Wake painting without showing the window,
            // then capture the refreshed frame (verified by the Electron smoke).
            await contents!.capturePage(undefined, { stayHidden: true, stayAwake: true });
            if (controller.signal.aborted || contents!.isDestroyed() || revision !== before) return undefined;
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (controller.signal.aborted || contents!.isDestroyed() || revision !== before) return undefined;
            return contents!.capturePage(undefined, { stayHidden: true, stayAwake: true });
          })(),
          new Promise<undefined>((resolve) => {
            cancelCapture = () => resolve(undefined);
            captureTimeout = setTimeout(cancelCapture, 2000);
            controller.signal.addEventListener("abort", cancelCapture, { once: true });
          }),
        ]);
        if (!image || controller.signal.aborted || contents.isDestroyed() || revision !== before || contents.getURL() !== url || image.isEmpty()) return;
        const safeUrl = new URL(url);
        safeUrl.search = "";
        safeUrl.hash = "";
        const frame = { at: new Date().toISOString(), label, url: safeUrl.toString(), image: image.toDataURL() };
        this.value = { ...this.value, latest: frame, snapshots: milestone ? [...this.value.snapshots, frame].slice(-8) : this.value.snapshots };
      } catch {
        // Navigation can invalidate a capture; retry on the next tick.
      } finally {
        if (captureTimeout) clearTimeout(captureTimeout);
        controller.signal.removeEventListener("abort", cancelCapture);
        capturing = false;
      }
    };
    const capture = (label: string, milestone = false) => {
      if (capturing && !milestone) return Promise.resolve();
      pendingCapture = pendingCapture.then(() => takeFrame(label, milestone));
      return pendingCapture;
    };
    const options: CartDebugRunOptions = {
      cartOnly: true,
      ready: (target) => {
        contents = target;
        contents.on("did-start-navigation", navigated);
        timer = setInterval(() => void capture("Live preview"), 750);
      },
      checkpoint: async (label) => {
        this.value = { ...this.value, message: label };
        await capture(label, true);
      },
    };
    this.job = (async () => {
      try {
        const outcome = await run(controller.signal, options);
        this.value = { ...this.value, message: controller.signal.aborted ? "Cart test stopped. Nothing was ordered." : outcome.message };
      } catch (error) {
        this.value = { ...this.value, message: controller.signal.aborted ? "Cart test stopped. Nothing was ordered." : error instanceof Error ? error.message : "Cart test failed." };
      } finally {
        if (timer) clearInterval(timer);
        contents?.removeListener("did-start-navigation", navigated);
        controller.abort();
        this.value = { ...this.value, running: false };
      }
    })();
    return this.value;
  }

  async stop(clear = false): Promise<CartDebugState> {
    this.controller?.abort();
    await this.job;
    if (clear) this.value = { running: false, message: "Ready for a cart-only test.", snapshots: [] };
    return this.value;
  }
}
