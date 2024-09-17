import { iso2ToIso3Map } from '@/lib/constants/country-alpha-2-to-3';
import { iso3ToName } from '@/lib/constants/country-alpha-3-to-name';
import prisma from '@/lib/database/prisma';
import { getSession } from '@/lib/utils/auth';
import { getLanguage, getSelectedTeam } from '@/lib/utils/header-helpers';
import { logger } from '@/lib/utils/logger';
import { ErrorResponse } from '@/types/common-api-types';
import { HttpStatus } from '@/types/http-status';
import { AuditLog, User } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { NextRequest, NextResponse } from 'next/server';
import { UAParser } from 'ua-parser-js';

export type IAuditLogsGetSuccessResponse = {
  auditLogs: (AuditLog & {
    user: Omit<User, 'passwordHash'> | null;
    alpha2: string | null;
    alpha3: string | null;
    country: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
  })[];
  totalAuditLogs: number;
};

export type IAuditLogsGetResponse =
  | ErrorResponse
  | IAuditLogsGetSuccessResponse;

export async function GET(
  request: NextRequest,
): Promise<NextResponse<IAuditLogsGetResponse>> {
  const t = await getTranslations({ locale: getLanguage() });

  try {
    const searchParams = request.nextUrl.searchParams;
    const selectedTeam = getSelectedTeam();

    if (!selectedTeam) {
      return NextResponse.json(
        {
          message: t('validation.team_not_found'),
        },
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const allowedPageSizes = [10, 25, 50, 100];
    const allowedSortDirections = ['asc', 'desc'];
    const allowedSortColumns = ['createdAt'];

    let page = parseInt(searchParams.get('page') as string) || 1;
    let pageSize = parseInt(searchParams.get('pageSize') as string) || 10;
    let sortColumn = searchParams.get('sortColumn') as string;
    let sortDirection = searchParams.get('sortDirection') as 'asc' | 'desc';

    if (!allowedSortDirections.includes(sortDirection)) {
      sortDirection = 'desc';
    }

    if (!sortColumn || !allowedSortColumns.includes(sortColumn)) {
      sortColumn = 'createdAt';
    }

    if (!allowedPageSizes.includes(pageSize)) {
      pageSize = 25;
    }

    if (page < 1) {
      page = 1;
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const session = await getSession({
      user: {
        include: {
          teams: {
            where: {
              deletedAt: null,
              id: selectedTeam,
            },
            include: {
              auditLogs: {
                where: {
                  createdAt: {
                    gte: new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000),
                  },
                },
                include: {
                  user: true,
                },
                orderBy: [
                  {
                    [sortColumn]: sortDirection,
                  },
                ],
                skip,
                take,
              },
            },
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json(
        {
          message: t('validation.unauthorized'),
        },
        { status: HttpStatus.UNAUTHORIZED },
      );
    }

    if (!session.user.teams.length) {
      return NextResponse.json(
        {
          message: t('validation.team_not_found'),
        },
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const totalAuditLogs = await prisma.auditLog.count({
      where: {
        teamId: selectedTeam,
        createdAt: {
          gte: new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000),
        },
      },
    });

    const auditlog = session.user.teams[0].auditLogs;

    const requestLogsWithCountries = auditlog.map((log) => {
      let browser: string | null = null;
      let os: string | null = null;
      let device: string | null = null;

      if (log.userAgent) {
        const parser = new UAParser(log.userAgent);
        const browserObj = parser.getBrowser();
        const osObj = parser.getOS();
        const deviceObj = parser.getDevice();

        browser = browserObj?.name
          ? `${browserObj.name} ${browserObj?.version ?? ''}`
          : null;
        os = osObj?.name ? `${osObj.name} ${osObj?.version ?? ''}` : null;
        device = deviceObj?.type ?? null;
      }

      return {
        ...log,
        country: log.country ? iso3ToName[log.country] : null,
        alpha3: log.country ?? null,
        alpha2:
          Object.keys(iso2ToIso3Map).find(
            (key) => iso2ToIso3Map[key] === log.country,
          ) ?? null,
        browser,
        os,
        device,
      };
    });

    return NextResponse.json({
      auditLogs: requestLogsWithCountries,
      totalAuditLogs,
    });
  } catch (error) {
    logger.error("Error occurred in 'auditlogs' route", error);
    return NextResponse.json(
      {
        message: t('general.server_error'),
      },
      { status: HttpStatus.INTERNAL_SERVER_ERROR },
    );
  }
}
