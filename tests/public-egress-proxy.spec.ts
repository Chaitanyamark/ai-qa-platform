import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { expect, test } from "@playwright/test";
import {
  createPublicEgressProxy,
  isPublicIpAddress,
  validatePublicHttpUrl,
} from "../src/lib/public-egress-proxy";

test("rejects private, reserved, and IPv4-mapped IPv6 addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.10.20",
    "172.20.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "203.0.113.4",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::1",
  ]) {
    expect(isPublicIpAddress(address), address).toBe(false);
  }

  expect(isPublicIpAddress("8.8.8.8")).toBe(true);
  expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  expect(isPublicIpAddress("::ffff:8.8.8.8")).toBe(true);
});

test("canonicalizes alternate numeric IPv4 notation before public-IP validation", async () => {
  expect(new URL("http://2130706433").hostname).toBe("127.0.0.1");
  expect(new URL("http://0x7f000001").hostname).toBe("127.0.0.1");
  await expect(validatePublicHttpUrl("http://2130706433")).rejects.toThrow(
    "not public",
  );
});

test("rejects DNS names that resolve to any non-public address", async () => {
  await expect(
    validatePublicHttpUrl("https://public.qa", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ]),
  ).rejects.toThrow("non-public");
});

test("allows only standard public HTTP and HTTPS ports", async () => {
  await expect(
    validatePublicHttpUrl("https://public.qa:8443", async () => [
      { address: "93.184.216.34", family: 4 },
    ]),
  ).rejects.toThrow("ports 80 and 443");
});

test("blocks a redirect from a public host to a private IP", async () => {
  test.setTimeout(15_000);
  const fixtureRequests: string[] = [];
  const fixture = createServer((request, response) => {
    fixtureRequests.push(request.url ?? "");
    if (request.url === "/start") {
      response.writeHead(302, { location: "http://127.0.0.1/secret" });
      response.end();
      return;
    }
    response.writeHead(200);
    response.end("This path must not be reached.");
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const fixtureAddress = fixture.address();
  if (!fixtureAddress || typeof fixtureAddress === "string") {
    throw new Error("Could not start the private test fixture.");
  }

  const proxy = createPublicEgressProxy({
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    connector: () => connect(fixtureAddress.port, "127.0.0.1"),
  });
  try {
    const proxyUrl = await proxy.listen();
    const firstResponse = await requestViaProxy(proxyUrl, "http://public.qa/start");
    expect(firstResponse.status).toBe(302);
    expect(firstResponse.location).toBe("http://127.0.0.1/secret");
    if (!firstResponse.location) throw new Error("Expected the private redirect URL.");

    // Chromium follows redirects by issuing another request through its configured
    // proxy. Model those two requests directly so this security test stays local.
    const redirectedResponse = await requestViaProxy(proxyUrl, firstResponse.location);
    expect(redirectedResponse.status).toBe(403);
    expect(fixtureRequests).toEqual(["/start"]);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});

function requestViaProxy(
  proxyUrl: string,
  targetUrl: string,
): Promise<{ status: number; location: string | undefined }> {
  const proxy = new URL(proxyUrl);
  const target = new URL(targetUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: proxy.hostname,
        port: Number(proxy.port),
        method: "GET",
        path: target.toString(),
        headers: { host: target.host },
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(3_000, () =>
      request.destroy(new Error(`Proxy request timed out for ${targetUrl}.`)),
    );
    request.end();
  });
}
