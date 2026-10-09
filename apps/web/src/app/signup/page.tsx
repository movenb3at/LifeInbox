import { Suspense } from "react";
import { AuthForm } from "@/features/auth/auth-form";
import { authConfigured } from "@/lib/auth/config";
import { Setup } from "@/components/setup";
export const dynamic = "force-dynamic";
export default function Signup() { return authConfigured() ? <Suspense><AuthForm mode="signup" /></Suspense> : <div className="standalone-setup"><Setup /></div>; }
