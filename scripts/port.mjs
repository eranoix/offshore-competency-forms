/**
 * A port the machine says is free. Binding to port 0 has the OS name a free
 * port; a random or fixed port can collide with another service or with the
 * leftover server of a run that did not shut down cleanly.
 */
import { createServer } from "node:net";

export const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
