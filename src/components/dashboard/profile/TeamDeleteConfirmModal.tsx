/* eslint-disable no-unused-vars */
import LoadingButton from '@/components/shared/LoadingButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useState, useTransition } from 'react';

interface DeleteTeamConfirmModalProps {
  team: Team | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (team: Team, teamNameConfirmation: string) => Promise<void>;
  open: boolean;
}

export function DeleteTeamConfirmModal({
  team,
  onOpenChange,
  onConfirm,
  open,
}: DeleteTeamConfirmModalProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [confirmName, setConfirmName] = useState('');

  if (!team) return null;

  const handleConfirm = async () => {
    startTransition(async () => {
      await onConfirm(team, confirmName);
      onOpenChange(false);
    });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('dashboard.profile.delete_team_confirm_title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t.rich('dashboard.profile.delete_team_confirm_description', {
              teamName: team.name,
              strong: (child) => <strong>{child}</strong>,
            })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="grid w-full gap-1.5 px-4">
          <Label htmlFor="confirmName">
            {t.rich('dashboard.profile.delete_team_confirm_input', {
              teamName: `"${team.name.toUpperCase()}"`,
              code: (child) => (
                <code className="text-xs font-semibold">{child}</code>
              ),
            })}
          </Label>
          <Input
            id="confirmName"
            onChange={(e) => setConfirmName(e.target.value)}
          />
        </div>
        <ResponsiveDialogFooter>
          <LoadingButton
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('general.cancel')}
          </LoadingButton>
          <LoadingButton
            disabled={confirmName !== team.name.toUpperCase()}
            pending={pending}
            size="sm"
            variant="destructive"
            onClick={handleConfirm}
          >
            {t('dashboard.profile.delete_team')}
          </LoadingButton>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
