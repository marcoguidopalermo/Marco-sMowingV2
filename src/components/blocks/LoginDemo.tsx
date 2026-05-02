'use client';
import { Auth } from '@/components/ui/auth-form-1';
import heroImg from '@/public/images/hero.png';

export function LoginDemo({ 
  onSubmit, 
  onGoogleSubmit,
  onSignUp
}: { 
  onSubmit: (email: string, pass: string) => void; 
  onGoogleSubmit: () => void;
  onSignUp?: (name: string, email: string, pass: string) => void;
}) {

  return (
    <section className='relative min-h-screen w-full flex items-center justify-center overflow-hidden font-["Outfit"]'>
      {/* BACKGROUND IMAGE WITH ZOOM ANIMATION */}
      <div className="absolute inset-0 z-0">
        <img 
          src={heroImg} 
          alt="Marco's Mowing Hero" 
          className="w-full h-full object-cover animate-hero-zoom scale-105" 
        />
        {/* PREMIUM GRADIENT OVERLAY */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/60 to-slate-900/90" />
      </div>

      {/* FLOATING NAVBAR STYLE LOGO */}
      <div className="absolute top-0 left-0 right-0 p-8 flex justify-between items-center z-20 max-md:justify-center">
         <div className="flex items-center gap-2 font-black text-2xl tracking-tighter text-white">
            <span className="text-3xl">🌿</span>
            <span>Marco's <span className="text-green-400">Mowing</span></span>
         </div>
         <div className="flex items-center gap-4 max-md:hidden">
            <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-[10px] font-black uppercase tracking-widest text-white">
                ✦ Trusted Since 2018
            </div>
         </div>
      </div>

      {/* CENTRAL AUTH CARD */}
      <div className='relative z-10 w-full max-w-md px-4 py-20'>
        <Auth 
          onSignInSuccess={onSubmit}
          onSignUpSuccess={onSignUp}
          onGoogleLogin={onGoogleSubmit}
          className="w-full"
        />
      </div>

      {/* FOOTER DECORATION */}
      <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-8 text-[9px] font-black uppercase tracking-[0.2em] text-white/30 z-20 pointer-events-none max-md:flex-col max-md:items-center max-md:gap-2">
          <span>Premium Lawn Care</span>
          <span className="max-md:hidden">•</span>
          <span>Landscape Excellence</span>
          <span className="max-md:hidden">•</span>
          <span>Property Management</span>
      </div>
    </section>
  );
}
