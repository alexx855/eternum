export function isExtensionClientHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "realms.world" ||
    hostname === "play.realms.party" ||
    hostname === "play.jcndata.com" ||
    hostname.endsWith(".realms.world")
  );
}

export function isExtensionClientUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsedUrl = new URL(url);
    return isExtensionClientProtocol(parsedUrl.protocol) && isExtensionClientHostname(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function isExtensionClientProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}
