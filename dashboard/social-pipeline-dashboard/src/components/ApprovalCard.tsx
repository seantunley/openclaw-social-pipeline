import { useState } from 'react';
import { cn, formatDate } from '@/lib/utils';
import { CheckCircle2, XCircle, RotateCcw, Image as ImageIcon } from 'lucide-react';
import StatusBadge from './StatusBadge';
import Modal from './Modal';
import { useT } from '@/lib/i18n';

interface ApprovalCardProps {
  run: {
    id: string;
    platform?: string;
    campaign?: string;
    status: string;
    content?: string;
    mediaThumbnail?: string;
    createdAt?: string;
  };
  onApprove: (id: string, notes?: string) => void;
  onReject: (id: string, reason: string) => void;
  onRevise: (id: string, notes: string) => void;
}

export default function ApprovalCard({ run, onApprove, onReject, onRevise }: ApprovalCardProps) {
  const t = useT();
  const [modalType, setModalType] = useState<'reject' | 'revise' | null>(null);
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (modalType === 'reject') {
      onReject(run.id, notes);
    } else if (modalType === 'revise') {
      onRevise(run.id, notes);
    }
    setModalType(null);
    setNotes('');
  };

  return (
    <>
      <div className="rounded-xl border border-border-strong bg-surface-soft backdrop-blur-sm overflow-hidden">
        <div className="flex">
          {run.mediaThumbnail ? (
            <div className="w-32 h-32 flex-shrink-0 bg-zinc-800">
              <img
                src={run.mediaThumbnail}
                alt="Media"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-32 h-32 flex-shrink-0 bg-zinc-800 flex items-center justify-center">
              <ImageIcon className="h-8 w-8 text-faint" />
            </div>
          )}
          <div className="flex-1 p-4">
            <div className="flex items-center gap-2 mb-2">
              {run.platform && (
                <span className="text-xs font-medium text-indigo-400 uppercase">
                  {run.platform}
                </span>
              )}
              <StatusBadge status={run.status} />
              {run.campaign && (
                <span className="text-xs text-muted ml-auto">{run.campaign}</span>
              )}
            </div>
            <p className="text-sm text-secondaryText line-clamp-3">
              {run.content || t('approvals.no_preview')}
            </p>
            {run.createdAt && (
              <p className="mt-1 text-xs text-muted">{formatDate(run.createdAt)}</p>
            )}
          </div>
        </div>
        <div className="flex border-t border-border-strong">
          <button
            onClick={() => onApprove(run.id)}
            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          >
            <CheckCircle2 className="h-4 w-4" />
            {t('approvals.approve')}
          </button>
          <button
            onClick={() => setModalType('reject')}
            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors border-l border-border-strong"
          >
            <XCircle className="h-4 w-4" />
            {t('approvals.reject')}
          </button>
          <button
            onClick={() => setModalType('revise')}
            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium text-yellow-400 hover:bg-yellow-500/10 transition-colors border-l border-border-strong"
          >
            <RotateCcw className="h-4 w-4" />
            {t('approvals.revise')}
          </button>
        </div>
      </div>

      <Modal
        open={!!modalType}
        onClose={() => {
          setModalType(null);
          setNotes('');
        }}
        title={modalType === 'reject' ? t('approvals.reject_title') : t('approvals.revise_title')}
      >
        <div className="space-y-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              modalType === 'reject'
                ? t('approvals.reject_placeholder')
                : t('approvals.revise_placeholder')
            }
            rows={4}
            className="w-full rounded-lg bg-zinc-800 border border-border-strong px-4 py-3 text-sm text-primaryText placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setModalType(null);
                setNotes('');
              }}
              className="rounded-lg px-4 py-2 text-sm text-muted hover:text-secondaryText transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!notes.trim()}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                modalType === 'reject'
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-yellow-500 text-black hover:bg-yellow-600'
              )}
            >
              {modalType === 'reject' ? t('approvals.reject') : t('approvals.request_revision')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
