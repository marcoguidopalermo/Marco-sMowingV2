'use client';
import { useState, ChangeEvent, FormEvent, ReactNode } from 'react';
import {
  Ripple,
  AuthTabs,
  TechOrbitDisplay,
} from '@/components/ui/modern-animated-sign-in';
import { Leaf, Truck, Scissors, Flower2, Sprout, Wind, MapPin, Calendar, CheckCircle } from 'lucide-react';
import logo from '@/public/logo/logowhite.png';

type FormData = {
  email: string;
  password: string;
};

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

export function LoginDemo({ onSubmit, onGoogleSubmit }: { onSubmit: (email: string, pass: string) => void; onGoogleSubmit: () => void }) {
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
  });

  const goToForgotPassword = (
    event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>
  ) => {
    event.preventDefault();
    console.log('forgot password');
  };

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement>,
    name: keyof FormData
  ) => {
    const value = event.target.value;

    setFormData((prevState) => ({
      ...prevState,
      [name]: value,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(formData.email, formData.password);
  };

  const formFields = {
    header: "Marco's Mowing ERP",
    subHeader: 'Secure Access to Operations & Crew Management',
    fields: [
      {
        label: 'Email',
        required: true,
        type: 'email' as const,
        placeholder: 'Enter your crew email',
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          handleInputChange(event, 'email'),
      },
      {
        label: 'Password',
        required: true,
        type: 'password' as const,
        placeholder: 'Enter your secure password',
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          handleInputChange(event, 'password'),
      },
    ],
    submitButton: 'Launch Dashboard',
    textVariantButton: 'Forgot access credentials?',
  };

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

      {/* Right Side: Animated Login Form */}
      <div className='w-1/2 h-[100dvh] flex flex-col justify-center items-center max-lg:w-full max-lg:px-[10%] relative z-10'>
        <div className="bg-white/95 backdrop-blur-md p-10 rounded-3xl shadow-2xl border border-white/20 w-full max-w-lg">
          <AuthTabs
            formFields={formFields}
            goTo={goToForgotPassword}
            handleSubmit={handleSubmit}
            onGoogleClick={onGoogleSubmit}
          />
        </div>
      </div>
    </section>
  );
}
