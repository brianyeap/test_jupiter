import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import fetch from "cross-fetch";
import { Wallet } from "@project-serum/anchor";
import bs58 from "bs58";
import { getSignature } from "./getSignature";
import { transactionSenderAndConfirmationWaiter } from "./transactionSender";

const connection = new Connection(
  ""
);
const wallet = new Wallet(
  Keypair.fromSecretKey(
    bs58.decode(
      process.env.PRIVATE_KEY ||
        ""
    )
  )
);

async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number,
  dexes: string
) {
  try {
    let params = [
      `inputMint=${inputMint}`,
      `outputMint=${outputMint}`,
      `amount=${amount}`,
      `slippageBps=${slippageBps}`,
    ];

    if (dexes !== "") {
      params.push(`dexes=${dexes}`);
    }
    const queryString = params.join("&");
    const response = await fetch(
      `https://quote-api.jup.ag/v6/quote?${queryString}`
    );
    const quoteResponse = await response.json();
    console.log(quoteResponse);
    return quoteResponse;
  } catch (error) {
    console.error("Error fetching quote:", error);
  }
  return null;
}

async function getSwapTransaction(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number,
  dexes: string,
  computeFee: number,
  jitoTipFee: number
) {
  const quoteResponse = await getQuote(
    inputMint,
    outputMint,
    amount,
    slippageBps,
    dexes
  );
  if (!quoteResponse) {
    console.error("No quote response");
    return null;
  }

  const response = await fetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      quoteResponse: quoteResponse,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      computeUnitPriceMicroLamports: computeFee || "auto",
      //   prioritizationFeeLamports: {"jitoTipLamports": 100000}
    }),
  });

  const { swapTransaction } = await response.json();
  console.log(swapTransaction);
  return swapTransaction;
}

export async function jupiterV6Swap(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number,
  dexes: string,
  computeFee: number,
  jitoTipFee: number
) {
  try {
    const swapTransaction = await getSwapTransaction(
      inputMint,
      outputMint,
      amount,
      slippageBps,
      dexes,
      computeFee,
      jitoTipFee
    );
    if (swapTransaction) {
      const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([wallet.payer]);
      const signature = getSignature(transaction);

      const { value: simulatedTransactionResponse } =
        await connection.simulateTransaction(transaction, {
          replaceRecentBlockhash: true,
          commitment: "processed",
        });
      const { err, logs } = simulatedTransactionResponse;

      if (err) {
        console.error("Simulation Error:");
        console.error({ err, logs });
        return;
      }

      const serializedTransaction = Buffer.from(transaction.serialize());
      const blockhash = transaction.message.recentBlockhash;

      const transactionResponse = await transactionSenderAndConfirmationWaiter({
        connection,
        serializedTransaction,
        blockhashWithExpiryBlockHeight: {
          blockhash,
          lastValidBlockHeight: swapObj.lastValidBlockHeight,
        },
      });

      // If we are not getting a response back, the transaction has not confirmed.
      if (!transactionResponse) {
        console.error("Transaction not confirmed");
        return;
      }

      if (transactionResponse.meta?.err) {
        console.error(transactionResponse.meta?.err);
      }

      console.log(`https://solscan.io/tx/${signature}`);
    }
  } catch (error) {
    console.error("Error getting swap transaction:", error);
  }
}

(async () => {
  try {
    let tx = await jupiterV6Swap(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "So11111111111111111111111111111111111111112",
      1 * 10 ** 6,
      500,
      "",
      5000,
      5000
    );

    console.log(tx);
  } catch (error) {
    console.error("Error executing swap:", error);
  }
})();
