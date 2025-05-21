import { Client, credentials } from "@grpc/grpc-js";
import { LRUCache } from "lru-cache";

const grpcClientCache = new LRUCache<string, Client>({
  max: 10,
  ttl: 30 * 60 * 1000, //  30 minutes,
  dispose: (client) => client.close(),
});

/**
 * the tlsRootCert should be a valid PEM string
 */
export async function getOrCreateGrpcClient({
  peerEndpoint,
  peerName,
  tlsRootCert,
}: {
  peerEndpoint: string;
  peerName: string;
  tlsRootCert?: string;
}) {
  const cacheKey = `${peerEndpoint}-${peerName}-${tlsRootCert}`;
  const cachedClient = grpcClientCache.get(cacheKey);

  if (cachedClient) {
    return cachedClient;
  }

  const tlsCredentials = credentials.createSsl(
    tlsRootCert ? Buffer.from(tlsRootCert) : undefined
  );
  const newClient = new Client(peerEndpoint, tlsCredentials, {
    "grpc.ssl_target_name_override": peerName,
  });

  grpcClientCache.set(cacheKey, newClient);

  return newClient;
}
