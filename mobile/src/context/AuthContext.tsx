import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import { signInWithEmail, signUpWithEmail, signOut as authSignOut } from "../services/auth";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    displayName?: string,
    phoneNumber?: string
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<{ error: string | null }>;
  loginAsDemo: (name?: string, email?: string) => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signIn: async () => ({ error: "Not initialized" }),
  signUp: async () => ({ error: "Not initialized" }),
  signOut: async () => ({ error: "Not initialized" }),
  loginAsDemo: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;

    // Fetch initial session
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const res = await signInWithEmail(email, password);
    if (res.session) {
      setSession(res.session);
      setUser(res.user);
    }
    return { error: res.error };
  };

  const signUp = async (
    email: string,
    password: string,
    displayName?: string,
    phoneNumber?: string
  ) => {
    const res = await signUpWithEmail(email, password, displayName, phoneNumber);
    if (res.session) {
      setSession(res.session);
      setUser(res.user);
    }
    return { error: res.error };
  };

  const signOut = async () => {
    const res = await authSignOut();
    setSession(null);
    setUser(null);
    return res;
  };

  const loginAsDemo = (name: string = "Akaza", userEmail: string = "chouhanaditya169@gmail.com") => {
    const mockUser: User = {
      id: "demo-user-123",
      app_metadata: { provider: "email" },
      user_metadata: { display_name: name, full_name: name },
      aud: "authenticated",
      created_at: new Date().toISOString(),
      email: userEmail,
      role: "authenticated",
    } as unknown as User;

    const mockSession: Session = {
      access_token: "mock-demo-access-token",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "mock-demo-refresh-token",
      user: mockUser,
    };

    setSession(mockSession);
    setUser(mockUser);
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signIn, signUp, signOut, loginAsDemo }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
