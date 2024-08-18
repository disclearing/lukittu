import LoadingButton from '@/components/shared/LoadingButton';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Team } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';

interface LeaveTeamConfirmModalProps {
  team: Team | null;
  // eslint-disable-next-line no-unused-vars
  onOpenChange: (open: boolean) => void;
  open: boolean;
  // eslint-disable-next-line no-unused-vars
  onConfirm: (team: Team) => Promise<void>;
}

export function LeaveTeamConfirmModal({
  team,
  onOpenChange,
  open,
  onConfirm,
}: LeaveTeamConfirmModalProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [confirmTimer, setConfirmTimer] = useState(15);

  useEffect(() => {
    if (confirmTimer === 0) {
      return;
    }

    const timer = setTimeout(() => {
      setConfirmTimer(confirmTimer - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [confirmTimer]);

  if (!team) return null;

  const handleConfirm = async () => {
    startTransition(async () => {
      await onConfirm(team);
      onOpenChange(false);
    });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('dashboard.profile.team_leave_confirm_title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t.rich('dashboard.profile.team_leave_confirm_description', {
              teamName: team.name,
              strong: (child) => <strong>{child}</strong>,
            })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <LoadingButton
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('general.cancel')}
          </LoadingButton>
          <LoadingButton
            disabled={confirmTimer > 0}
            pending={pending}
            size="sm"
            variant="destructive"
            onClick={handleConfirm}
          >
            {confirmTimer === 0
              ? t('dashboard.profile.leave_team')
              : `${t('dashboard.profile.leave_team')} (${confirmTimer})`}
          </LoadingButton>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
