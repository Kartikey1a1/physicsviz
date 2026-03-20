import { Inter } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import WarmupPing from "@/components/WarmupPing";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "PhysicsViz — AP Physics C Solver",
  description: "Step-by-step AP Physics C solutions with synchronized interactive simulations",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* Pre-warms the SymPy worker on Render/Railway before the user interacts */}
        <WarmupPing />
        {children}
      </body>
    </html>
  );
}
