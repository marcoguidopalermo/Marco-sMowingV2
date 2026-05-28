import type { ReactNode } from 'react';
import { CloudSun, X } from 'lucide-react';
import { formatDate } from '../lib/dateUtils';

interface WeatherModalProps {
  isOpen: boolean;
  onClose: () => void;
  weekDays: Date[];
  weather: Record<string, any>;
  getWeatherIcon: (code: number | undefined) => ReactNode;
  getWeatherDescription: (code: number | undefined) => string;
}

export default function WeatherModal({ isOpen, onClose, weekDays, weather, getWeatherIcon, getWeatherDescription }: WeatherModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-xl shadow-2xl h-full md:h-auto w-full md:max-w-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-green-50">
          <h2 className="text-xl font-bold flex items-center gap-2 text-green-900">
            <CloudSun className="w-6 h-6 text-green-600" /> 7-Day Weather Forecast
          </h2>
          <button onClick={onClose}><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          <div className="space-y-3">
            {weekDays.map(date => {
              const dStr = formatDate(date);
              const w = weather[dStr];
              if (!w) return null;
              return (
                <div key={dStr} className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="w-24 font-bold text-gray-700">{date.toLocaleDateString('en-US', { weekday: 'long' })}</div>
                  <div className="flex items-center gap-3 w-32">
                    {getWeatherIcon(w.code)}
                    <div className="text-sm font-medium"><span className="text-red-600">{w.max}°</span> / <span className="text-green-600">{w.min}°</span></div>
                  </div>
                  <div className="flex-1 text-sm text-gray-600 font-medium">{getWeatherDescription(w.code)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
