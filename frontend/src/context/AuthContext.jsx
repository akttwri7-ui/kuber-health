import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { http } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = signed out

  const check = useCallback(async () => {
    try {
      const { data } = await http.get("/auth/me");
      setUser(data);
    } catch {
      try {
        await http.post("/auth/refresh");
        const { data } = await http.get("/auth/me");
        setUser(data);
      } catch {
        setUser((u) => u || false);
      }
    }
  }, []);

  useEffect(() => {
    // Returning from Google OAuth: AuthCallback establishes the session first
    if (window.location.hash?.includes("session_id=")) return;
    check();
  }, [check]);

  const logout = async () => {
    try { await http.post("/auth/logout"); } catch {}
    setUser(false);
  };

  return <AuthCtx.Provider value={{ user, setUser, logout, check }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
