import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import {
  CONTRACT_ABI,
  CONTRACT_ADDRESS,
  EXPECTED_CHAIN_ID,
  EXPECTED_NETWORK_NAME,
} from "../config/contract";

const Web3Context = createContext(null);

function getMetaMaskProvider() {
  if (typeof window === "undefined") return null;

  const injected = window.ethereum;
  if (!injected) return null;

  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    return injected.providers.find((provider) => provider?.isMetaMask) || injected.providers[0];
  }

  return injected;
}

export function Web3Provider({ children }) {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const attemptedReconnect = useRef(false);

  const setupProvider = useCallback(async (ethereum) => {
    const nextProvider = new ethers.providers.Web3Provider(ethereum);
    const nextSigner = nextProvider.getSigner();
    const network = await nextProvider.getNetwork();

    setProvider(nextProvider);
    setSigner(nextSigner);
    setChainId(network.chainId);

    if (CONTRACT_ADDRESS && CONTRACT_ABI.length > 0) {
      setContract(new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, nextSigner));
    } else {
      setContract(null);
    }

    return { nextProvider, nextSigner, network };
  }, []);

  const connectWallet = useCallback(async () => {
    const injectedProvider = getMetaMaskProvider();
    if (!injectedProvider) {
      setError("MetaMask was not detected. Open this page in the same browser profile where MetaMask is installed.");
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const tempProvider = new ethers.providers.Web3Provider(injectedProvider);
      const accounts = await tempProvider.send("eth_requestAccounts", []);
      const { network } = await setupProvider(injectedProvider);
      setAccount(accounts[0] || null);
      setChainId(network.chainId);
    } catch (err) {
      if (err?.code === 4001) {
        setError("MetaMask connection request was rejected.");
      } else if (err?.code === -32002) {
        setError("MetaMask is already showing a connection request. Open the extension popup and finish it first.");
      } else {
        setError(err?.message || "Failed to connect wallet.");
      }
    } finally {
      setConnecting(false);
    }
  }, [setupProvider]);

  const disconnectWallet = useCallback(() => {
    setAccount(null);
    setProvider(null);
    setSigner(null);
    setContract(null);
    setChainId(null);
    setError(null);
  }, []);

  useEffect(() => {
    const injectedProvider = getMetaMaskProvider();
    if (!injectedProvider) return undefined;

    const onAccountsChanged = async (accounts) => {
      if (!accounts.length) {
        disconnectWallet();
        return;
      }

      setAccount(accounts[0]);
      await setupProvider(injectedProvider);
    };

    const onChainChanged = async (nextChainIdHex) => {
      setChainId(parseInt(nextChainIdHex, 16));
      await setupProvider(injectedProvider);
    };

    injectedProvider.on("accountsChanged", onAccountsChanged);
    injectedProvider.on("chainChanged", onChainChanged);

    return () => {
      injectedProvider.removeListener("accountsChanged", onAccountsChanged);
      injectedProvider.removeListener("chainChanged", onChainChanged);
    };
  }, [disconnectWallet, setupProvider]);

  const wrongNetwork = chainId != null && chainId !== EXPECTED_CHAIN_ID;
  const deploymentReady = Boolean(CONTRACT_ADDRESS && CONTRACT_ABI.length > 0);

  const value = useMemo(
    () => ({
      account,
      provider,
      signer,
      contract,
      chainId,
      connecting,
      error,
      wrongNetwork,
      expectedNetwork: EXPECTED_NETWORK_NAME,
      deploymentReady,
      connectWallet,
      disconnectWallet,
    }),
    [
      account,
      provider,
      signer,
      contract,
      chainId,
      connecting,
      error,
      wrongNetwork,
      deploymentReady,
      connectWallet,
      disconnectWallet,
    ],
  );

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (!context) {
    throw new Error("useWeb3 must be used inside Web3Provider");
  }
  return context;
}
