'use client';
import { ReactNode } from 'react';
import {
  Ripple,
  TechOrbitDisplay,
} from '@/components/ui/modern-animated-sign-in';
import { Auth } from '@/components/ui/auth-form-1';
import { Leaf, Truck, Scissors, Flower2, Sprout, Wind, MapPin, Calendar, CheckCircle } from 'lucide-react';
import logo from '@/public/logo/logowhite.png';

interface OrbitIcon {
  component: () => ReactNode;
  className: string;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
  reverse?: boolean;
}

// LANDSCAPING THEMED ICONS
const iconsArray: OrbitIcon[] = [
  {
    component: () => <Leaf className="w-6 h-6 text-lime-400" />,
    className: 'size-[40px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    duration: 25,
    delay: 5,
    radius: 120,
    path: true,
  },
  {
    component: () => <Truck className="w-6 h-6 text-green-400" />,
    className: 'size-[45px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    duration: 20,
    delay: 15,
    radius: 120,
    path: false,
  },
  {
    component: () => <Scissors className="w-8 h-8 text-lime-300" />,
    className: 'size-[50px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    radius: 220,
    duration: 30,
    path: true,
  },
  {
    component: () => <Flower2 className="w-8 h-8 text-emerald-400" />,
    className: 'size-[50px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    radius: 220,
    duration: 30,
    delay: 10,
    path: false,
    reverse: true
  },
  {
    component: () => <Sprout className="w-6 h-6 text-lime-500" />,
    className: 'size-[40px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    duration: 18,
    delay: 20,
    radius: 160,
    path: true,
    reverse: true,
  },
  {
    component: () => <Wind className="w-6 h-6 text-slate-300" />,
    className: 'size-[40px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    duration: 18,
    delay: 10,
    radius: 160,
    path: false,
  },
  {
    component: () => <MapPin className="w-10 h-10 text-rose-400" />,
    className: 'size-[60px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    radius: 290,
    duration: 35,
    path: true,
  },
  {
    component: () => <Calendar className="w-10 h-10 text-sky-400" />,
    className: 'size-[60px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    radius: 290,
    duration: 35,
    delay: 15,
    path: false,
    reverse: true,
  },
  {
    component: () => <CheckCircle className="w-12 h-12 text-lime-500" />,
    className: 'size-[70px] border-none bg-slate-800/50 rounded-full flex items-center justify-center',
    radius: 360,
    duration: 40,
    delay: 25,
    path: true,
  },
];

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
    <section className='flex max-lg:justify-center bg-slate-900 min-h-screen relative overflow-hidden'>
      {/* Branding Logo - Floating */}
      <div className="absolute top-8 left-8 z-50">
        <img src={logo} alt="Marco's Mowing" className="h-16 w-auto" />
      </div>

      {/* Left Side: Animated Brand Display */}
      <div className='flex flex-col justify-center w-1/2 max-lg:hidden relative'>
        <Ripple mainCircleSize={120} mainCircleOpacity={0.1} className="opacity-50" />
        <TechOrbitDisplay iconsArray={iconsArray} text="MARCO'S MOWING" />
      </div>

      {/* Right Side: New Auth Form */}
      <div className='w-1/2 h-[100dvh] flex flex-col justify-center items-center max-lg:w-full max-lg:px-[10%] relative z-10'>
        <Auth 
          onSignInSuccess={onSubmit}
          onSignUpSuccess={onSignUp}
          onGoogleLogin={onGoogleSubmit}
          className="shadow-none border-none bg-transparent"
        />
      </div>
    </section>
  );
}
