import { Sparkles, X, Loader2 } from 'lucide-react';

interface AIInsightModalProps {
  isOpen: boolean;
  title: string;
  content: string;
  isLoading: boolean;
  onClose: () => void;
}

export default function AIInsightModal({ isOpen, title, content, isLoading, onClose }: AIInsightModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex md:items-center md:justify-center md:p-4">
      <div className="bg-white md:rounded-2xl shadow-2xl h-full md:h-auto w-full md:max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95">
        <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gradient-to-r from-teal-50 to-purple-50">
          <h2 className="text-lg font-bold flex items-center gap-2 text-teal-900">
            <Sparkles className="w-5 h-5 text-teal-600" /> {title}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 min-w-[44px] min-h-[44px] inline-flex items-center justify-center">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[60vh] text-gray-800 text-sm leading-relaxed">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-teal-500 gap-4">
              <Loader2 className="w-10 h-10 animate-spin" />
              <p className="font-bold tracking-wide animate-pulse">Gemini AI is analyzing...</p>
            </div>
          ) : (
            <div className="whitespace-pre-wrap">
              {content.split('\n').map((line, i) => {
                if (line.startsWith('* ') || line.startsWith('- ')) return <li key={i} className="ml-4 mb-2 font-medium text-slate-700">{line.substring(2).replace(/\*\*(.*?)\*\*/g, '$1')}</li>;
                if (line.trim() === '') return <br key={i} />;
                return <p key={i} className="mb-2 font-semibold text-slate-800">{line.replace(/\*\*(.*?)\*\*/g, '$1')}</p>;
              })}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
          <button onClick={onClose} className="px-6 py-2.5 font-bold text-teal-700 bg-teal-100 hover:bg-teal-200 rounded-lg transition-colors">
            Close Insight
          </button>
        </div>
      </div>
    </div>
  );
}
