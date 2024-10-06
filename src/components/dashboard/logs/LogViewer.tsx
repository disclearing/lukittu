'use client';
import {
  ILogsGetResponse,
  ILogsGetSuccessResponse,
} from '@/app/api/(dashboard)/logs/route';
import { DateConverter } from '@/components/shared/DateConverter';
import LoadingButton from '@/components/shared/LoadingButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/tailwind-helpers';
import { ChevronLeft, Copy, ExternalLink, Logs } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  LogViewerLeftSkeleton,
  LogViewerRightSkeleton,
} from './LogViewerSkeleton';

export default function LogViewer() {
  const t = useTranslations();
  const locale = useLocale();

  const [hasMore, setHasMore] = useState(true);
  const [selectedLog, setSelectedLog] = useState<
    ILogsGetSuccessResponse['logs'][number] | null
  >(null);
  const [showDetails, setShowDetails] = useState(false);
  const [totalLogs, setTotalLogs] = useState(1);
  const [logs, setLogs] = useState<ILogsGetSuccessResponse['logs'][]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);

  const loadSelectedTeam = useCallback(() => {
    const cookies = document.cookie.split(';');
    const selectedTeam = cookies.find((cookie) =>
      cookie.includes('selectedTeam'),
    );
    return selectedTeam ? selectedTeam.split('=')[1] : null;
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const searchParams = new URLSearchParams({
        page: page.toString(),
        pageSize: '10',
      });

      const response = await fetch(`/api/logs?${searchParams.toString()}`);

      const data = (await response.json()) as ILogsGetResponse;

      if ('message' in data) {
        return toast.error(data.message);
      }

      setTotalLogs(data.totalResults);
      setLogs((prevLogs) => {
        const newLogs = [...prevLogs.flat(), ...data.logs];
        const uniqueLogs = Array.from(
          new Map(newLogs.map((log) => [log.id, log])).values(),
        );

        setHasMore(data.totalResults > uniqueLogs.length);

        const groupedLogs = uniqueLogs.reduce(
          (acc, log) => {
            const date = new Date(log.createdAt).toDateString();
            acc[date] = acc[date];
            acc[date].push(log);
            return acc;
          },
          {} as Record<string, ILogsGetSuccessResponse['logs']>,
        );

        return Object.values(groupedLogs);
      });
    } catch (error: any) {
      toast.error(error.message ?? t('general.server_error'));
    } finally {
      setLoading(false);
      setFetchingMore(false);
    }
  }, [page, t]);

  const teamId = loadSelectedTeam();

  useEffect(() => {
    if (teamId) {
      setSelectedLog(null);
      setLogs([]);
    }

    setPage(1);
    setLoading(true);
  }, [teamId]);

  useEffect(() => {
    fetchLogs();
  }, [page, fetchLogs]);

  useEffect(() => {
    if (!selectedLog && logs.length > 0) {
      setSelectedLog(logs[0][0]);
    }
  }, [logs, selectedLog]);

  const handleLogClick = (log: ILogsGetSuccessResponse['logs'][number]) => {
    setSelectedLog(log);
    setShowDetails(true);
  };

  return (
    <Card className="flex flex-col md:flex-row">
      {totalLogs ? (
        <>
          <div
            className={`w-full border-r p-2 md:w-1/2 ${showDetails ? 'hidden md:block' : 'block'}`}
          >
            <div className="p-4">
              <h2 className="mb-4 mt-1 text-xl font-bold tracking-tight">
                {t('dashboard.navigation.logs')}
              </h2>
              {loading ? (
                <LogViewerLeftSkeleton />
              ) : (
                logs.map((log, index) => (
                  <div
                    key={index}
                    className={cn('mb-4', {
                      'mb-0': index === logs.length - 1,
                    })}
                  >
                    <h3 className="mb-2 text-sm font-normal text-muted-foreground">
                      {new Date(log[0].createdAt).toLocaleDateString(locale, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </h3>
                    <Separator className="mb-2" />
                    <div className="grid grid-cols-1">
                      {log.map((l, indexInner) => (
                        <div
                          key={`${index}-${indexInner}`}
                          className="group relative mb-2"
                        >
                          <div className="absolute inset-0 -mx-2 rounded-lg transition-colors group-hover:bg-secondary/80 md:hidden" />
                          <Button
                            className={cn(
                              'relative z-10 w-full justify-start gap-2 text-left max-md:px-0 max-md:hover:bg-inherit',
                              {
                                'md:bg-muted': selectedLog?.id === l.id,
                              },
                            )}
                            variant="ghost"
                            onClick={() => handleLogClick(l)}
                          >
                            <Badge className="mr-2" variant="outline">
                              {l.status}
                            </Badge>
                            <span className="mr-2">{l.method}</span>
                            <span className="truncate text-muted-foreground">
                              {l.path}
                            </span>
                            <DateConverter
                              date={l.createdAt}
                              displayType="time"
                            />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <LoadingButton
                disabled={!hasMore}
                pending={fetchingMore || loading}
                variant="link"
                onClick={() => {
                  setFetchingMore(true);
                  setPage((prev) => prev + 1);
                }}
              >
                {t('general.load_more')}
              </LoadingButton>
            </div>
          </div>
          <div
            className={`w-full p-2 md:w-1/2 ${showDetails ? 'block' : 'hidden md:block'}`}
          >
            {loading ? (
              <LogViewerRightSkeleton />
            ) : selectedLog ? (
              <div className="p-4">
                <div className="mb-4 flex items-center">
                  <Button
                    className="mr-2 md:hidden"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowDetails(false)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <h2
                    className="flex-grow truncate text-lg font-semibold tracking-tight md:mt-1"
                    title={`${selectedLog.method} ${selectedLog.path}`}
                  >
                    {selectedLog.method} {selectedLog.path}
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t('general.code')}
                    </p>
                    <Badge className="text-xs" variant="outline">
                      {selectedLog.status}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">ID</p>
                    <div className="text-sm">
                      <span className="flex items-center gap-2">
                        <Copy className="h-4 w-4 shrink-0" />
                        <TooltipProvider>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <span
                                className="truncate text-primary hover:underline"
                                role="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(selectedLog.id);
                                  toast.success(
                                    t('general.copied_to_clipboard'),
                                  );
                                }}
                              >
                                {selectedLog.id}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t('general.click_to_copy')}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t('general.created_at')}
                    </p>
                    <div className="text-sm">
                      <DateConverter date={selectedLog.createdAt} />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t('general.ip_address')}
                    </p>
                    <div className="flex items-center gap-2 truncate text-sm">
                      {selectedLog.alpha2 && (
                        <Image
                          alt={selectedLog.alpha3 ?? t('general.unknown')}
                          className="rounded-[2px]"
                          height={20}
                          src={`/countries/${selectedLog.alpha2.toLowerCase()}.svg`}
                          width={20}
                        />
                      )}
                      {selectedLog.ipAddress ?? t('general.unknown')}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t('general.device')}
                    </p>
                    <p className="text-sm">
                      {selectedLog.browser || selectedLog.os
                        ? `${selectedLog.browser ?? ''} - ${selectedLog.os ?? ''}`
                        : t('general.unknown')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t('general.origin')}
                    </p>
                    <p className="text-sm">
                      {selectedLog.origin ?? t('general.unknown')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard.licenses.status')}
                    </p>
                    <p className="text-sm">{selectedLog.statusCode}</p>
                  </div>
                </div>
                <div className="mt-2">
                  <Button className="p-0" variant="link" asChild>
                    {!selectedLog.licenseId ? (
                      <Button
                        className="flex items-center gap-2"
                        variant="link"
                        disabled
                      >
                        {t('general.license')}
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Link
                        className="flex items-center gap-2"
                        href={`/dashboard/licenses/${selectedLog.licenseId}`}
                      >
                        {t('general.license')}
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    )}
                  </Button>
                </div>
                <Separator className="my-4" />
                <h3 className="mb-2 font-semibold">
                  {t('dashboard.logs.request_body')}
                </h3>
                <pre className="overflow-x-auto rounded-md bg-muted p-4">
                  <code>
                    {JSON.stringify(selectedLog.requestBody, null, 2)}
                  </code>
                </pre>
                <h3 className="mb-2 mt-4 font-semibold">
                  {t('dashboard.logs.response_body')}
                </h3>
                <pre className="overflow-x-auto rounded-md bg-muted p-4">
                  <code>
                    {JSON.stringify(selectedLog.responseBody, null, 2)}
                  </code>
                </pre>
              </div>
            ) : (
              <div className="p-4 text-center text-muted-foreground">
                {t('dashboard.logs.select_log')}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="w-full">
          <h2 className="my-1 p-6 text-xl font-bold tracking-tight">
            {t('dashboard.navigation.logs')}
          </h2>
          <div className="flex w-full flex-col items-center justify-center p-6 pt-0">
            <div className="flex w-full max-w-xl flex-col items-center justify-center gap-4 py-20">
              <div className="flex">
                <span className="rounded-lg bg-secondary p-4">
                  <Logs className="h-6 w-6" />
                </span>
              </div>
              <h3 className="text-lg font-bold">
                {t('dashboard.logs.no_logs_title')}
              </h3>
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                {t('dashboard.logs.no_logs_description')}
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
