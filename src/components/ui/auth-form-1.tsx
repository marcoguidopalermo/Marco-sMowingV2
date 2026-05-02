"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Eye, EyeOff, Loader2, MailCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import logo from "@/public/logo/LOGOBLACK.png";

// --------------------------------
// Types and Enums
// --------------------------------

enum AuthView {
  SIGN_IN = "sign-in",
  SIGN_UP = "sign-up",
  FORGOT_PASSWORD = "forgot-password",
  RESET_SUCCESS = "reset-success",
}

interface AuthState {
  view: AuthView;
}

interface FormState {
  isLoading: boolean;
  error: string | null;
  showPassword: boolean;
}

// --------------------------------
// Schemas
// --------------------------------

const signInSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const signUpSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  terms: z.boolean().refine((val) => val === true, {
    message: "You must agree to the terms",
  }),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type SignInFormValues = z.infer<typeof signInSchema>;
type SignUpFormValues = z.infer<typeof signUpSchema>;
type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

// --------------------------------
// Main Auth Component
// --------------------------------

function Auth({ className, onSignInSuccess, onSignUpSuccess, onGoogleLogin, ...props }: React.ComponentProps<"div"> & { onSignInSuccess?: (email: string, pass: string) => void; onSignUpSuccess?: (name: string, email: string, pass: string) => void; onGoogleLogin?: () => void }) {
  const [state, setState] = React.useState<AuthState>({ view: AuthView.SIGN_IN });

  const setView = React.useCallback((view: AuthView) => {
    setState((prev) => ({ ...prev, view }));
  }, []);

  return (
    <div
      data-slot="auth"
      className={cn("mx-auto w-full max-w-md", className)}
      {...props}
    >
      <div className="relative overflow-hidden rounded-[20px] bg-white p-2 shadow-2xl">
        <div className="relative z-10 bg-white rounded-[18px] border border-slate-100">
          <div className="pt-10 flex flex-col items-center gap-2">
             <div className="flex items-center gap-2 font-black text-2xl tracking-tighter text-slate-900">
                <span className="text-3xl">🌿</span>
                <span>Marco's <span className="text-green-600">Mowing</span></span>
             </div>
             <div className="h-1 w-12 bg-green-500 rounded-full mt-2" />
          </div>
          
          <AnimatePresence mode="wait">
            {state.view === AuthView.SIGN_IN && (
              <AuthSignIn
                key="sign-in"
                onForgotPassword={() => setView(AuthView.FORGOT_PASSWORD)}
                onSignUp={() => setView(AuthView.SIGN_UP)}
                onSubmitSuccess={onSignInSuccess}
                onGoogleLogin={onGoogleLogin}
              />
            )}
            {state.view === AuthView.SIGN_UP && (
              <AuthSignUp
                key="sign-up"
                onSignIn={() => setView(AuthView.SIGN_IN)}
                onSubmitSuccess={onSignUpSuccess}
                onGoogleLogin={onGoogleLogin}
              />
            )}
            {state.view === AuthView.FORGOT_PASSWORD && (
              <AuthForgotPassword
                key="forgot-password"
                onSignIn={() => setView(AuthView.SIGN_IN)}
                onSuccess={() => setView(AuthView.RESET_SUCCESS)}
              />
            )}
            {state.view === AuthView.RESET_SUCCESS && (
              <AuthResetSuccess
                key="reset-success"
                onSignIn={() => setView(AuthView.SIGN_IN)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
      
      <div className="mt-8 flex justify-center gap-6 text-[10px] font-bold uppercase tracking-widest text-white/50">
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-400" /> Secure Encryption</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-400" /> Crew Access Only</span>
      </div>
    </div>
  );
}

// --------------------------------
// Shared Components
// --------------------------------

interface AuthFormProps {
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
  className?: string;
}

function AuthForm({ onSubmit, children, className }: AuthFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      data-slot="auth-form"
      className={cn("space-y-5", className)}
    >
      {children}
    </form>
  );
}

interface AuthErrorProps {
  message: string | null;
}

function AuthError({ message }: AuthErrorProps) {
  if (!message) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-600 flex items-center gap-2"
    >
      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      {message}
    </motion.div>
  );
}

interface AuthSocialButtonsProps {
  isLoading: boolean;
  onGoogleLogin?: () => void;
}

function AuthSocialButtons({ isLoading, onGoogleLogin }: AuthSocialButtonsProps) {
  return (
    <div data-slot="auth-social-buttons" className="w-full mt-6">
      <Button
        variant="outline"
        className="w-full h-12 bg-white border-slate-200 hover:bg-slate-50 transition-all active:scale-[0.98] rounded-xl font-bold text-slate-700 shadow-sm"
        disabled={isLoading}
        onClick={(e) => {
          e.preventDefault();
          onGoogleLogin?.();
        }}
      >
        <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </Button>
    </div>
  );
}

interface AuthSeparatorProps {
  text?: string;
}

function AuthSeparator({ text = "Or use email" }: AuthSeparatorProps) {
  return (
    <div data-slot="auth-separator" className="relative mt-8 mb-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-slate-100" />
      </div>
      <div className="relative flex justify-center text-[10px] uppercase font-black tracking-widest text-slate-400">
        <span className="bg-white px-4">{text}</span>
      </div>
    </div>
  );
}

// --------------------------------
// Sign In Component
// --------------------------------

interface AuthSignInProps {
  onForgotPassword: () => void;
  onSignUp: () => void;
  onSubmitSuccess?: (email: string, pass: string) => void;
  onGoogleLogin?: () => void;
}

function AuthSignIn({ onForgotPassword, onSignUp, onSubmitSuccess, onGoogleLogin }: AuthSignInProps) {
  const [formState, setFormState] = React.useState<FormState>({
    isLoading: false,
    error: null,
    showPassword: false,
  });

  const { register, handleSubmit, formState: { errors } } = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: SignInFormValues) => {
    setFormState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      if (onSubmitSuccess) {
        await onSubmitSuccess(data.email, data.password);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (err: any) {
      setFormState((prev) => ({ ...prev, error: err.message || "Invalid credentials" }));
    } finally {
      setFormState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  return (
    <motion.div
      data-slot="auth-sign-in"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="p-10 pt-6"
    >
      <div className="mb-8 text-center">
        <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Crew Login</h1>
        <p className="mt-1 text-xs font-bold text-slate-400 uppercase tracking-widest">Access your dashboard</p>
      </div>

      <AuthError message={formState.error} />

      <AuthForm onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-[11px] font-black uppercase text-slate-500 tracking-wider">Email Address</Label>
          <Input
            id="email"
            type="email"
            placeholder="marco@marcosmowing.com"
            disabled={formState.isLoading}
            className={cn("h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-green-500 focus:bg-white transition-all font-medium", errors.email && "border-red-300 bg-red-50")}
            {...register("email")}
          />
          {errors.email && <p className="text-[10px] font-bold text-red-500 mt-1">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" title="Priority Repair" className="text-[11px] font-black uppercase text-slate-500 tracking-wider">Secure Password</Label>
            <button
              type="button"
              className="text-[10px] font-black uppercase tracking-widest text-green-600 hover:text-green-700 transition-colors"
              onClick={onForgotPassword}
              disabled={formState.isLoading}
            >
              Forgot?
            </button>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={formState.showPassword ? "text" : "password"}
              placeholder="••••••••"
              disabled={formState.isLoading}
              className={cn("h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-green-500 focus:bg-white transition-all font-medium", errors.password && "border-red-300 bg-red-50")}
              {...register("password")}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 text-slate-400 hover:bg-transparent"
              onClick={() =>
                setFormState((prev) => ({ ...prev, showPassword: !prev.showPassword }))
              }
              disabled={formState.isLoading}
            >
              {formState.showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          {errors.password && <p className="text-[10px] font-bold text-red-500 mt-1">{errors.password.message}</p>}
        </div>

        <Button type="submit" className="w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-xl font-black uppercase tracking-widest shadow-lg shadow-green-600/20 transition-all active:scale-[0.98]" disabled={formState.isLoading}>
          {formState.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            "Launch Dashboard →"
          )}
        </Button>
      </AuthForm>

      <AuthSeparator />
      <AuthSocialButtons isLoading={formState.isLoading} onGoogleLogin={onGoogleLogin} />

      <p className="mt-8 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">
        New team member?{" "}
        <button
          type="button"
          className="text-green-600 hover:text-green-700 font-black"
          onClick={onSignUp}
          disabled={formState.isLoading}
        >
          Create Account
        </button>
      </p>
    </motion.div>
  );
}

// --------------------------------
// Sign Up Component
// --------------------------------

interface AuthSignUpProps {
  onSignIn: () => void;
  onSubmitSuccess?: (name: string, email: string, pass: string) => void;
  onGoogleLogin?: () => void;
}

function AuthSignUp({ onSignIn, onSubmitSuccess, onGoogleLogin }: AuthSignUpProps) {
  const [formState, setFormState] = React.useState<FormState>({
    isLoading: false,
    error: null,
    showPassword: false,
  });

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "", terms: false as any },
  });

  const terms = watch("terms");

  const onSubmit = async (data: SignUpFormValues) => {
    setFormState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      if (onSubmitSuccess) {
        await onSubmitSuccess(data.name, data.email, data.password);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (err: any) {
      setFormState((prev) => ({ ...prev, error: err.message || "Registration failed" }));
    } finally {
      setFormState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  return (
    <motion.div
      data-slot="auth-sign-up"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-10 pt-6"
    >
      <div className="mb-8 text-center">
        <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Join the Crew</h1>
        <p className="mt-1 text-xs font-bold text-slate-400 uppercase tracking-widest">Register for access</p>
      </div>

      <AuthError message={formState.error} />

      <AuthForm onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-[11px] font-black uppercase text-slate-500 tracking-wider">Full Name</Label>
          <Input
            id="name"
            type="text"
            placeholder="John Doe"
            disabled={formState.isLoading}
            className={cn("h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-green-500 focus:bg-white transition-all font-medium", errors.name && "border-red-300 bg-red-50")}
            {...register("name")}
          />
          {errors.name && <p className="text-[10px] font-bold text-red-500 mt-1">{errors.name.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-[11px] font-black uppercase text-slate-500 tracking-wider">Email Address</Label>
          <Input
            id="email"
            type="email"
            placeholder="marco@marcosmowing.com"
            disabled={formState.isLoading}
            className={cn("h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-green-500 focus:bg-white transition-all font-medium", errors.email && "border-red-300 bg-red-50")}
            {...register("email")}
          />
          {errors.email && <p className="text-[10px] font-bold text-red-500 mt-1">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-[11px] font-black uppercase text-slate-500 tracking-wider">Create Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={formState.showPassword ? "text" : "password"}
              placeholder="••••••••"
              disabled={formState.isLoading}
              className={cn("h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-green-500 focus:bg-white transition-all font-medium", errors.password && "border-red-300 bg-red-50")}
              {...register("password")}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 text-slate-400 hover:bg-transparent"
              onClick={() =>
                setFormState((prev) => ({ ...prev, showPassword: !prev.showPassword }))
              }
              disabled={formState.isLoading}
            >
              {formState.showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          {errors.password && <p className="text-[10px] font-bold text-red-500 mt-1">{errors.password.message}</p>}
        </div>

        <div className="flex items-center space-x-3 py-2">
          <Checkbox
            id="terms"
            checked={terms as any}
            onCheckedChange={(checked) => setValue("terms", (checked === true) as true)}
            disabled={formState.isLoading}
            className="w-5 h-5 rounded-lg border-slate-300 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
          />
          <Label htmlFor="terms" className="text-[11px] font-bold text-slate-500 leading-tight">
            I agree to the <button type="button" className="text-green-600 underline">Terms of Operations</button> and safety protocols.
          </Label>
        </div>
        {errors.terms && <p className="text-[10px] font-bold text-red-500 mt-1">{errors.terms.message}</p>}

        <Button type="submit" className="w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-xl font-black uppercase tracking-widest shadow-lg shadow-green-600/20 transition-all active:scale-[0.98]" disabled={formState.isLoading}>
          {formState.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            "Create Account →"
          )}
        </Button>
      </AuthForm>

      <AuthSeparator />
      <AuthSocialButtons isLoading={formState.isLoading} onGoogleLogin={onGoogleLogin} />

      <p className="mt-8 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">
        Already have an account?{" "}
        <button
          type="button"
          className="text-green-600 hover:text-green-700 font-black"
          onClick={onSignIn}
          disabled={formState.isLoading}
        >
          Sign In
        </button>
      </p>
    </motion.div>
  );
}

// --------------------------------
// Forgot Password Component
// --------------------------------

interface AuthForgotPasswordProps {
  onSignIn: () => void;
  onSuccess: () => void;
}

function AuthForgotPassword({ onSignIn, onSuccess }: AuthForgotPasswordProps) {
  const [formState, setFormState] = React.useState<FormState>({
    isLoading: false,
    error: null,
    showPassword: false,
  });

  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordFormValues) => {
    setFormState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      onSuccess();
    } catch {
      setFormState((prev) => ({ ...prev, error: "System error" }));
    } finally {
      setFormState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  return (
    <motion.div
      data-slot="auth-forgot-password"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="p-10 pt-12 relative"
    >
      <button
        className="absolute left-6 top-10 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
        onClick={onSignIn}
        disabled={formState.isLoading}
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      <div className="mb-8 text-center">
        <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Reset Password</h1>
        <p className="mt-1 text-xs font-bold text-slate-400 uppercase tracking-widest">Recover access</p>
      </div>

      <AuthError message={formState.error} />

      <AuthForm onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-[11px] font-black uppercase text-slate-500 tracking-wider">Email Address</Label>
          <Input
            id="email"
            type="email"
            placeholder="marco@marcosmowing.com"
            disabled={formState.isLoading}
            className={cn("h-12 bg-slate-50 border-slate-200 rounded-xl focus:ring-green-500 focus:bg-white transition-all font-medium", errors.email && "border-red-300 bg-red-50")}
            {...register("email")}
          />
          {errors.email && <p className="text-[10px] font-bold text-red-500 mt-1">{errors.email.message}</p>}
        </div>

        <Button type="submit" className="w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-xl font-black uppercase tracking-widest shadow-lg shadow-green-600/20 transition-all" disabled={formState.isLoading}>
          {formState.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            "Send Reset Link →"
          )}
        </Button>
      </AuthForm>
    </motion.div>
  );
}

// --------------------------------
// Reset Success Component
// --------------------------------

interface AuthResetSuccessProps {
  onSignIn: () => void;
}

function AuthResetSuccess({ onSignIn }: AuthResetSuccessProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center p-10 py-16 text-center"
    >
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 border-4 border-white shadow-xl shadow-green-100/50">
        <MailCheck className="h-10 w-10 text-green-600" />
      </div>

      <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Check Email</h1>
      <p className="mt-2 text-xs font-bold text-slate-400 uppercase tracking-widest max-w-[200px] leading-relaxed">
        We sent instructions to recover your account.
      </p>

      <Button
        variant="outline"
        className="mt-10 w-full h-12 border-2 border-green-600 text-green-600 hover:bg-green-50 rounded-xl font-black uppercase tracking-widest transition-all"
        onClick={onSignIn}
      >
        Return to Login
      </Button>
    </motion.div>
  );
}

// --------------------------------
// Exports
// --------------------------------

export {
  Auth,
  AuthSignIn,
  AuthSignUp,
  AuthForgotPassword,
  AuthResetSuccess,
  AuthForm,
  AuthError,
  AuthSocialButtons,
  AuthSeparator,
};
