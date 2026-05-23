"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import SpotlightBackground from "@/components/ui/spotlight-background";
import { LoginForm } from "@/components/ui/login-form";
import ThemeSwitch from "@/components/ui/theme-switch";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

function LoginContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Show error toast if redirected with an error
  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "auth_callback_failed") {
      toast.error("Authentication failed. Please try again.");
    }
  }, [searchParams]);

  // Redirect to home if already authenticated
  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  // Show nothing while checking auth state (prevents flash)
  if (loading || user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <SpotlightBackground>
      {/* Theme toggle */}
      <div className="fixed top-6 right-6 z-50">
        <ThemeSwitch />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4"
      >
        {/* Logo / Brand */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-8 text-center"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-foreground tracking-tight mb-2">
            CodeKavi
          </h1>
          <p className="text-sm text-muted-foreground font-light">
            NotebookLM for GitHub
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
        >
          <LoginForm />
        </motion.div>
      </motion.div>
    </SpotlightBackground>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen flex items-center justify-center bg-background">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
