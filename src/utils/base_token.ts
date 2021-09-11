import { Web3SideChainClient } from "./web3_side_chain_client";
import { ITransactionConfig, ITransactionOption, IContractInitParam } from "../interfaces";
import { BaseContractMethod, BaseContract } from "../abstracts";
import { merge } from "../utils";
import { EXTRA_GAS_FOR_PROXY_CALL, LOGGER } from "../constant";
import { ContractWriteResult } from "../helpers";
import { promiseResolve } from "./promise_resolve";

export interface ITransactionConfigParam {
    txConfig: ITransactionConfig;
    method?: BaseContractMethod;
    isWrite?: boolean;
    isParent?: boolean;
}

export class BaseToken {

    private contract_: BaseContract;

    constructor(
        protected contractParam: IContractInitParam,
        protected client: Web3SideChainClient,
    ) {
    }

    getContract(): Promise<BaseContract> {
        if (this.contract_) {
            return promiseResolve<BaseContract>(this.contract_ as any);
        }
        const contractParam = this.contractParam;
        return this.client.getABI(
            contractParam.tokenContractName,
            contractParam.bridgeType,
        ).then(abi => {
            this.contract_ = this.getContract_({
                abi,
                isParent: contractParam.isParent,
                tokenAddress: contractParam.tokenAddress
            });
            return this.contract_;
        });
    }

    protected processWrite(method: BaseContractMethod, option: ITransactionOption = {}): Promise<ContractWriteResult> {
        LOGGER.log("process write");
        return this.createTransactionConfig(
            {
                txConfig: option,
                isWrite: true,
                method,
                isParent: this.contractParam.isParent
            }).then(config => {
                LOGGER.log("process write config");
                if (option.returnTransaction) {
                    return merge(config, {
                        data: method.encodeABI(),
                        to: this.contract_.address
                    } as ITransactionConfig);
                }
                const methodResult = method.write(
                    config,
                );
                return new ContractWriteResult(methodResult);

            });
    }

    protected processRead<T>(method: BaseContractMethod, option: ITransactionOption = {}): Promise<T> {
        LOGGER.log("process read");
        return this.createTransactionConfig(
            {
                txConfig: option,
                isWrite: false,
                method,
                isParent: this.contractParam.isParent
            }).then(config => {
                LOGGER.log("process read config");
                if (option.returnTransaction) {
                    return merge(config, {
                        data: method.encodeABI(),
                        to: this.contract_.address
                    } as ITransactionConfig);
                }
                return method.read(
                    config,
                );
            });
    }

    private getContract_({ isParent, tokenAddress, abi }) {
        const client = isParent ? this.client.parent :
            this.client.child;
        return client.getContract(tokenAddress, abi);
    }

    protected get parentDefaultConfig() {
        return this.client.config.parent.defaultConfig;
    }

    protected get childDefaultConfig() {
        return this.client.config.child.defaultConfig;
    }

    protected async createTransactionConfig({ txConfig, method, isParent, isWrite }: ITransactionConfigParam) {
        const defaultConfig = isParent ? this.parentDefaultConfig : this.childDefaultConfig;
        txConfig = Object.assign(defaultConfig, (txConfig || {}));
        console.log("txConfig", txConfig, isParent, isWrite);
        const client = isParent ? this.client.parent :
            this.client.child;
        if (isWrite) {
            const [gasLimit, gasPrice, nonce, chainId] = await Promise.all([
                !(txConfig.gasLimit)
                    ? method.estimateGas({ from: txConfig.from, value: txConfig.value })
                    : txConfig.gasLimit,
                !txConfig.gasPrice ? client.getGasPrice() : txConfig.gasPrice,
                !txConfig.nonce ? client.getTransactionCount(txConfig.from as string, 'pending') : txConfig.nonce,
                !txConfig.chainId ? client.getChainId() : txConfig.chainId,
            ]);
            console.log("calculated");
            txConfig.gasLimit = isParent ? Number(gasLimit) + EXTRA_GAS_FOR_PROXY_CALL : gasLimit;
            txConfig.gasPrice = gasPrice;
            txConfig.nonce = nonce;
            txConfig.chainId = chainId;
        }
        return txConfig;
    }

}