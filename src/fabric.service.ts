import {
  Identity,
  Signer,
  Gateway,
  Network,
} from "@hyperledger/fabric-gateway";
import { initGateway } from "./lib/gateway";
import { getOrCreateGrpcClient } from "./lib/grpc";

export class FabricService {
  static async createForUser(
    identity: Identity,
    signer: Signer,
    peer: {
      name: string;
      endpoint: string;
      tlsRootCert?: string;
    }
  ) {
    const { name, endpoint, tlsRootCert } = peer;

    const client = await getOrCreateGrpcClient({
      peerEndpoint: endpoint,
      peerName: name,
      tlsRootCert,
    });
    const gateway = await initGateway(client, identity, signer);

    return new FabricService(gateway, client);
  }

  private constructor(private gateway: Gateway, private client: any) {}

  close(): void {
    this.gateway.close();
    //this.client.close(); //client is cached and auto cleaned up in the cache
  }

  getNetwork(channelName: string): Network {
    return this.gateway.getNetwork(channelName);
  }

  async evaluateTransaction({
    channelName,
    chaincodeName,
    contractName,
    fn,
    args = [],
  }: {
    channelName: string;
    chaincodeName: string;
    contractName?: string;
    fn: string;
    args: string[];
  }) {
    const result = await this.gateway
      .getNetwork(channelName)
      .getContract(chaincodeName, contractName)
      .evaluateTransaction(fn, ...args);

    return decodeResult(result);
  }

  async submitTransaction({
    channelName,
    chaincodeName,
    contractName,
    fn,
    args = [],
  }: {
    channelName: string;
    chaincodeName: string;
    contractName?: string;
    fn: string;
    args: string[];
  }) {
    const result = await this.gateway
      .getNetwork(channelName)
      .getContract(chaincodeName, contractName)
      .submitTransaction(fn, ...args);

    return decodeResult(result);
  }

  async submitAsync({
    channelName,
    chaincodeName,
    contractName,
    fn,
    args = [],
  }: {
    channelName: string;
    chaincodeName: string;
    contractName?: string;
    fn: string;
    args: string[];
  }) {
    const submittedTransaction = await this.gateway
      .getNetwork(channelName)
      .getContract(chaincodeName, contractName)
      .submitAsync(fn, { arguments: { ...args } });

    return submittedTransaction.getTransactionId();
  }

  async subscribeToChaincodeEvents(
    channelName: string,
    chaincodeName: string,
    options: {
      eventNames?: string[];
      startBlock?: bigint;
      endBlock?: bigint;
      maxEvents?: number;
    } = {}
  ) {
    const network = this.gateway.getNetwork(channelName);
    const eventsOptions: any = {};

    if (options.startBlock !== undefined) {
      eventsOptions.startBlock = options.startBlock;
    }

    return network.getChaincodeEvents(chaincodeName, eventsOptions);
  }

  async subscribeToBlockEvents(
    channelName: string,
    options: { startBlock?: bigint } = {}
  ): Promise<Awaited<ReturnType<Network["getBlockEvents"]>>> {
    const network = this.gateway.getNetwork(channelName);
    return network.getBlockEvents(options);
  }
}

function decodeResult(resultBytes: Uint8Array): object | string {
  const utf8Decoder = new TextDecoder();
  const resultJson = utf8Decoder.decode(resultBytes);
  try {
    return JSON.parse(resultJson);
  } catch {
    return resultJson;
  }
}
