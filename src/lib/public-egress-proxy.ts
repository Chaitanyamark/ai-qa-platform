import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, request as httpRequest, createServer, type IncomingMessage } from "node:http";
import { connect as netConnect, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";

export type ResolvedAddress = { address: string; family: number };
export type PublicAddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;
type Connector = (address: string, port: number) => Socket;

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".test",
  ".example",
  ".invalid",
  ".onion",
];

const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  return address
    .split(".")
    .reduce((value, octet) => (value << 8) | Number(octet), 0) >>> 0;
}

function isInIpv4Cidr(address: string, network: string, prefix: number): boolean {
  const addressNumber = ipv4Number(address);
  const networkNumber = ipv4Number(network);
  if (addressNumber === null || networkNumber === null) return true;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressNumber & mask) === (networkNumber & mask);
}

function parseIpv6(address: string): number[] | null {
  let value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value.includes("%")) return null;

  const ipv4Tail = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (ipv4Tail) {
    const number = ipv4Number(ipv4Tail);
    if (number === null) return null;
    const first = (number >>> 16) & 0xffff;
    const second = number & 0xffff;
    value = value.replace(ipv4Tail, `${first.toString(16)}:${second.toString(16)}`);
  }

  const pieces = value.split("::");
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  if (left.concat(right).some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }

  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) {
    return null;
  }

  return [
    ...left.map((part) => parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((part) => parseInt(part, 16)),
  ];
}

export function isPublicIpAddress(rawAddress: string): boolean {
  const address = rawAddress.replace(/^\[|\]$/g, "");
  const family = isIP(address);

  if (family === 4) {
    return !BLOCKED_IPV4_CIDRS.some(([network, prefix]) =>
      isInIpv4Cidr(address, network, prefix),
    );
  }

  if (family !== 6) return false;
  const words = parseIpv6(address);
  if (!words) return false;

  // IPv4-mapped IPv6 addresses inherit the IPv4 classification.
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const mapped = `${words[6] >>> 8}.${words[6] & 0xff}.${words[7] >>> 8}.${words[7] & 0xff}`;
    return isPublicIpAddress(mapped);
  }

  // Accept only IPv6 global-unicast space, then exclude special-purpose blocks.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return false;
  if (words[0] === 0x2001 && words[1] <= 0x01ff) return false;
  if (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0010) return false;
  if (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0020) return false;
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false;
  if (words[0] === 0x2002) return false;
  if (words[0] === 0x3fff && (words[1] & 0xf000) === 0) return false;
  return true;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

function isBlockedHostname(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

async function defaultResolver(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function resolvePublicAddress(
  rawHostname: string,
  resolver: PublicAddressResolver,
): Promise<string> {
  const hostname = stripIpv6Brackets(rawHostname).replace(/\.$/, "");
  if (!hostname || isBlockedHostname(hostname)) {
    throw new Error("The target hostname is not public.");
  }

  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new Error("The target IP address is not public.");
    }
    return hostname;
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new Error("The target hostname could not be resolved.");
  }

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    throw new Error("The target hostname resolves to a non-public IP address.");
  }

  return addresses[0].address;
}

function getAllowedPort(url: URL, expectedProtocol?: "http:" | "https:"): number {
  if (expectedProtocol && url.protocol !== expectedProtocol) {
    throw new Error("Only HTTP and HTTPS targets are allowed.");
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" && port !== 80) ||
    (url.protocol === "https:" && port !== 443)
  ) {
    throw new Error("Only public HTTP and HTTPS ports 80 and 443 are allowed.");
  }
  return port;
}

export async function validatePublicHttpUrl(
  rawUrl: string,
  resolver: PublicAddressResolver = defaultResolver,
): Promise<URL> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Please provide a valid URL.");
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  if (target.username || target.password) {
    throw new Error("URLs with embedded credentials are not supported.");
  }
  getAllowedPort(target);
  await resolvePublicAddress(target.hostname, resolver);
  return target;
}

function errorResponse(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  const reason = status === 403 ? "Forbidden" : "Bad Request";
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
}

function closeProxyConnection(socket: Duplex): void {
  if (!socket.destroyed) socket.destroy();
}

function createUpstreamSocket(
  connector: Connector,
  address: string,
  port: number,
): Socket {
  const socket = connector(address, port);
  socket.setTimeout(10_000, () => socket.destroy(new Error("Upstream timeout.")));
  return socket;
}

export function createPublicEgressProxy(options: {
  resolver?: PublicAddressResolver;
  connector?: Connector;
} = {}) {
  const resolver = options.resolver ?? defaultResolver;
  const connector = options.connector ?? ((address, port) => netConnect(port, address));
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void (async () => {
      let target: URL;
      try {
        target = new URL(request.url ?? "");
        if (target.protocol !== "http:" || target.username || target.password) {
          throw new Error("Invalid proxy target.");
        }
        const port = getAllowedPort(target, "http:");
        const address = await resolvePublicAddress(target.hostname, resolver);
        const headers = { ...request.headers };
        delete headers["proxy-authorization"];
        delete headers["proxy-connection"];
        headers.host = target.host;
        headers.connection = "close";

        const agent = new Agent({ keepAlive: false });
        agent.createConnection = () => {
          const socket = createUpstreamSocket(connector, address, port);
          sockets.add(socket);
          socket.once("close", () => sockets.delete(socket));
          return socket;
        };
        response.once("close", () => agent.destroy());
        const upstream = httpRequest({
          hostname: address,
          family: isIP(address),
          port,
          method: request.method,
          path: `${target.pathname}${target.search}`,
          headers,
          agent,
        }, (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.statusMessage,
            upstreamResponse.headers,
          );
          upstreamResponse.pipe(response);
        });

        upstream.on("error", () => {
          if (!response.headersSent) response.writeHead(502);
          response.end("Upstream request failed.");
        });
        request.pipe(upstream);
      } catch (error) {
        response.writeHead(
          error instanceof Error && /non-public|not public|not allowed/.test(error.message)
            ? 403
            : 400,
          { "content-type": "text/plain; charset=utf-8", connection: "close" },
        );
        response.end(
          error instanceof Error ? error.message : "Invalid proxy request.",
        );
      }
    })();
  });

  server.on("connect", (request: IncomingMessage, clientSocket, head) => {
    void (async () => {
      let target: URL;
      try {
        target = new URL(`https://${request.url ?? ""}`);
        if (target.username || target.password || target.pathname !== "/") {
          throw new Error("Invalid CONNECT target.");
        }
        const port = getAllowedPort(target, "https:");
        const address = await resolvePublicAddress(target.hostname, resolver);
        const upstream = createUpstreamSocket(connector, address, port);
        sockets.add(upstream);
        upstream.once("close", () => sockets.delete(upstream));
        upstream.once("error", () => closeProxyConnection(clientSocket));
        clientSocket.once("error", () => closeProxyConnection(upstream));
        upstream.once("connect", () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
      } catch (error) {
        errorResponse(
          clientSocket,
          error instanceof Error && /non-public|not public|not allowed/.test(error.message)
            ? 403
            : 400,
          error instanceof Error ? error.message : "Invalid CONNECT request.",
        );
      }
    })();
  });

  server.on("upgrade", (_request, socket) => {
    errorResponse(socket, 403, "WebSocket upgrades are not enabled in this demo.");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  return {
    async listen(): Promise<string> {
      if (server.listening) {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Could not determine the egress proxy address.");
        }
        return `http://127.0.0.1:${address.port}`;
      }
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not determine the egress proxy address.");
      }
      return `http://127.0.0.1:${address.port}`;
    },
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
