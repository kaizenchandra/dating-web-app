import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import { request as httpRequest, type Server } from "node:http";
export function websocketUpgrades(server: Server, origin: string) {
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/api/v1/socket" ||
      req.headers.origin !== origin ||
      head.length > 8192
    ) {
      socket.destroy();
      return;
    }
    const upstream = httpRequest({
      hostname: "communication",
      port: 4000,
      path: "/api/v1/socket",
      method: "GET",
      headers: {
        ...req.headers,
        host: "communication:4000",
        authorization: `Bearer ${serviceToken("communication")}`,
      },
      timeout: 6000,
    });
    upstream.on("upgrade", (response, remote, remoteHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders.reduce((s, v, i) => s + (i % 2 ? `${v}\r\n` : `${v}: `), "")}\r\n`,
      );
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
      socket.on("error", () => remote.destroy());
      remote.on("error", () => socket.destroy());
      socket.on("close", () => remote.destroy());
      remote.on("close", () => socket.destroy());
    });
    upstream.on("response", () => socket.destroy());
    upstream.on("timeout", () => {
      upstream.destroy();
      socket.destroy();
    });
    upstream.on("error", () => socket.destroy());
    upstream.end();
  });
}
