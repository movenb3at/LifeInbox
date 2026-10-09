import { Suspense } from "react";
import { AuthForm } from "@/features/auth/auth-form";
import { authConfigured } from "@/lib/auth/config";
import { Setup } from "@/components/setup";
export const dynamic = "force-dynamic";
export default function Login() { return authConfigured() ? <Suspense><AuthForm mode="login" /></Suspense> : <div className="standalone-setup"><Setup /></div>; }
