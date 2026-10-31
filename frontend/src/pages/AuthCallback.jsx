import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { http } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const sid = new URLSearchParams(location.hash.slice(1)).get("session_id");
    http.post("/auth/google/session", { session_id: sid })
      .then(({ data }) => {
        setUser(data);
        navigate("/dashboard", { replace: true });
      })
      .catch(() => {
        setUser(false);
        navigate("/login", { replace: true });
      });
  }, [location.hash, navigate, setUser]);

  return <div className="min-h-screen" />;
}
