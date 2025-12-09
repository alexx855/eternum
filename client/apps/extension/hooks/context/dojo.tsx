import { createContext, useContext, ReactNode } from "react";
import { SetupResult } from "@bibliothecadao/dojo";

const DojoContext = createContext<SetupResult | null>(null);

export const DojoProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: SetupResult;
}) => {
  return <DojoContext.Provider value={value}>{children}</DojoContext.Provider>;
};

export const useDojo = () => {
  const value = useContext(DojoContext);
  if (!value) throw new Error("Must be used within a DojoProvider");
  return value;
};
