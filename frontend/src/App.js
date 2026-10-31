import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Portfolio from "@/pages/Portfolio";
import Health from "@/pages/Health";
import Analyst from "@/pages/Analyst";
import Risk from "@/pages/Risk";
import Goals from "@/pages/Goals";
import Settings from "@/pages/Settings";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) return <div className="min-h-screen grid place-items-center"><div className="h-10 w-10 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/health" element={<Health />} />
        <Route path="/analyst" element={<Analyst />} />
        <Route path="/risk" element={<Risk />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster theme="dark" position="top-right" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
