import type { DocumentContext } from "next/document";
import { Head, Html, Main, NextScript } from "next/document";

interface DocumentProps {
  nonce?: string;
}

export default function Document({ nonce }: DocumentProps) {
  return (
    <Html suppressHydrationWarning>
      <Head nonce={nonce} />
      <body>
        <Main />
        <NextScript nonce={nonce} />
      </body>
    </Html>
  );
}

Document.getInitialProps = async (ctx: DocumentContext) => {
  const initialProps = await ctx.defaultGetInitialProps(ctx);
  const nonce = ctx.req?.headers?.["x-nonce"] as string | undefined;
  return { ...initialProps, nonce };
};
