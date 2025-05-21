import {
  connect,
  GrpcClient,
  hash,
  Identity,
  Signer,
} from "@hyperledger/fabric-gateway";

export async function initGateway(
  client: GrpcClient,
  identity: Identity,
  signer: Signer
) {
  const gateway = connect({
    client,
    identity,
    signer,
    hash: hash.sha256,
  });

  return gateway;
}
