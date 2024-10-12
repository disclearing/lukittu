import { iso2ToIso3Map } from '@/lib/constants/country-alpha-2-to-3';
import { regex } from '@/lib/constants/regex';
import prisma from '@/lib/database/prisma';
import { proxyCheck } from '@/lib/providers/proxycheck';
import { generateHMAC, signChallenge } from '@/lib/utils/crypto';
import { getIp } from '@/lib/utils/header-helpers';
import { logger } from '@/lib/utils/logger';
import { isRateLimited } from '@/lib/utils/rate-limit';
import {
  licenseHeartbeatSchema,
  LicenseHeartbeatSchema,
} from '@/lib/validation/licenses/license-heartbeat-schema';
import { HttpStatus } from '@/types/http-status';
import { BlacklistType, RequestStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

type IExternalLicenseHeartbeatResponse = {
  result: {
    timestamp: Date;
    valid: boolean;
    details: string;
    code: RequestStatus;
  };
};

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } },
): Promise<NextResponse<IExternalLicenseHeartbeatResponse>> {
  const teamId = params.slug;

  try {
    if (!teamId || !regex.uuidV4.test(teamId)) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: 'Invalid team UUID',
            code: RequestStatus.BAD_REQUEST,
          },
        },
        {
          status: HttpStatus.BAD_REQUEST,
        },
      );
    }

    const body = (await request.json()) as LicenseHeartbeatSchema;
    const validated = await licenseHeartbeatSchema().safeParseAsync(body);

    if (!validated.success) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: validated.error.errors[0].message,
            code: RequestStatus.BAD_REQUEST,
          },
        },
        {
          status: HttpStatus.BAD_REQUEST,
        },
      );
    }

    const ip = getIp();
    if (ip) {
      const key = `license-heartbeat:${ip}`;
      const isLimited = await isRateLimited(key, 5, 60); // 5 requests per 1 minute

      if (isLimited) {
        return NextResponse.json(
          {
            result: {
              timestamp: new Date(),
              valid: false,
              details: 'Rate limited',
              code: RequestStatus.RATE_LIMIT,
            },
          },
          {
            status: HttpStatus.TOO_MANY_REQUESTS,
          },
        );
      }
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        keyPair: {
          omit: {
            privateKey: false,
          },
        },
        settings: true,
        blacklist: true,
      },
    });

    const settings = team?.settings;

    if (!team || !settings) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: 'Team not found',
            code: RequestStatus.TEAM_NOT_FOUND,
          },
        },
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    const { licenseKey, deviceIdentifier, customerId, productId, challenge } =
      validated.data;

    const licenseKeyLookup = generateHMAC(`${licenseKey}:${teamId}`);

    const license = await prisma.license.findUnique({
      where: {
        team: {
          deletedAt: null,
        },
        teamId_licenseKeyLookup: { teamId, licenseKeyLookup },
      },
      include: {
        customers: true,
        products: true,
        heartbeats: true,
        requestLogs: {
          where: {
            createdAt: {
              gte: new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000), // 6 months
            },
          },
        },
      },
    });

    const licenseHasCustomers = Boolean(license?.customers.length);
    const licenseHasProducts = Boolean(license?.products.length);

    const hasStrictProducts = settings.strictProducts || false;
    const hasStrictCustomers = settings.strictCustomers || false;

    const matchingCustomer = license?.customers.find(
      (customer) => customer.id === customerId,
    );

    const matchingProduct = license?.products.find(
      (product) => product.id === productId,
    );

    if (!license) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: 'License not found',
            code: RequestStatus.LICENSE_NOT_FOUND,
          },
        },
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    const blacklistedIps = team.blacklist.filter(
      (b) => b.type === BlacklistType.IP_ADDRESS,
    );
    const blacklistedIpList = blacklistedIps.map((b) => b.value);

    if (ip && blacklistedIpList.includes(ip)) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: 'IP address is blacklisted',
            code: RequestStatus.IP_BLACKLISTED,
          },
        },
        {
          status: HttpStatus.FORBIDDEN,
        },
      );
    }

    const blacklistedCountries = team.blacklist.filter(
      (b) => b.type === BlacklistType.COUNTRY,
    );
    const blacklistedCountryList = blacklistedCountries.map((b) => b.value);

    if (blacklistedCountryList.length > 0) {
      const geoData = await proxyCheck(ip);

      if (geoData?.isocode) {
        const inIso3 = iso2ToIso3Map[geoData.isocode!];

        if (blacklistedCountryList.includes(inIso3)) {
          return NextResponse.json(
            {
              result: {
                timestamp: new Date(),
                valid: false,
                details: 'Country is blacklisted',
                code: RequestStatus.COUNTRY_BLACKLISTED,
              },
            },
            {
              status: HttpStatus.FORBIDDEN,
            },
          );
        }
      }
    }

    const blacklistedDeviceIdentifiers = team.blacklist.filter(
      (b) => b.type === BlacklistType.DEVICE_IDENTIFIER,
    );

    const blacklistedDeviceIdentifierList = blacklistedDeviceIdentifiers.map(
      (b) => b.value,
    );

    if (
      deviceIdentifier &&
      blacklistedDeviceIdentifierList.includes(deviceIdentifier)
    ) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: 'Device identifier is blacklisted',
            code: RequestStatus.DEVICE_IDENTIFIER_BLACKLISTED,
          },
        },
        {
          status: HttpStatus.FORBIDDEN,
        },
      );
    }

    const strictModeNoCustomerId =
      hasStrictCustomers && licenseHasCustomers && !customerId;
    const noCustomerMatch =
      licenseHasCustomers && customerId && !matchingCustomer;

    if (strictModeNoCustomerId || noCustomerMatch) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: 'Customer not found',
            code: RequestStatus.CUSTOMER_NOT_FOUND,
          },
        },
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    const strictModeNoProductId =
      hasStrictProducts && licenseHasProducts && !productId;
    const noProductMatch = licenseHasProducts && productId && !matchingProduct;

    if (strictModeNoProductId || noProductMatch) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: 'Product not found',
            code: RequestStatus.PRODUCT_NOT_FOUND,
          },
        },
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    if (license.suspended) {
      return NextResponse.json(
        {
          result: {
            timestamp: new Date(),
            valid: false,
            details: 'License suspended',
            code: RequestStatus.LICENSE_SUSPENDED,
          },
        },
        {
          status: HttpStatus.FORBIDDEN,
        },
      );
    }

    if (license.expirationType === 'DATE') {
      const expirationDate = new Date(license.expirationDate!);
      const currentDate = new Date();

      if (currentDate.getTime() > expirationDate.getTime()) {
        return NextResponse.json(
          {
            result: {
              timestamp: new Date(),
              valid: false,
              details: 'License expired',
              code: RequestStatus.LICENSE_EXPIRED,
            },
          },
          {
            status: HttpStatus.FORBIDDEN,
          },
        );
      }
    }

    if (license.expirationType === 'DURATION') {
      const hasStartedExpiring = Boolean(license.expirationDate);

      if (!hasStartedExpiring) {
        const expirationDays = license.expirationDays!;
        const expirationDate = new Date(
          new Date().getTime() + expirationDays * 24 * 60 * 60 * 1000,
        );

        await prisma.license.update({
          where: { teamId_licenseKeyLookup: { teamId, licenseKeyLookup } },
          data: {
            expirationDate,
          },
        });
      } else {
        const expirationDate = new Date(license.expirationDate!);
        const currentDate = new Date();

        if (currentDate.getTime() > expirationDate.getTime()) {
          return NextResponse.json(
            {
              result: {
                timestamp: new Date(),
                valid: false,
                details: 'License expired',
                code: RequestStatus.LICENSE_EXPIRED,
              },
            },
            {
              status: HttpStatus.FORBIDDEN,
            },
          );
        }
      }
    }

    if (license.ipLimit) {
      const ipAddress = getIp();
      const existingIps = license.requestLogs.map((log) => log.ipAddress);
      const ipLimitReached = existingIps.length >= license.ipLimit;

      // TODO: @KasperiP: Maybe add separate table for storing IP addresses because user's probably want to also remove old IP addresses
      if (!existingIps.includes(ipAddress) && ipLimitReached) {
        return NextResponse.json(
          {
            result: {
              timestamp: new Date(),
              valid: false,
              details: 'IP limit reached',
              code: RequestStatus.IP_LIMIT_REACHED,
            },
          },
          {
            status: HttpStatus.FORBIDDEN,
          },
        );
      }
    }

    if (license.seats) {
      const heartbeatTimeout = settings.heartbeatTimeout || 60;

      const activeSeats = license.heartbeats.filter(
        (heartbeat) =>
          new Date(heartbeat.lastBeatAt).getTime() >
          new Date(Date.now() - heartbeatTimeout * 60 * 1000).getTime(),
      );

      const seatsIncludesClient = activeSeats.some(
        (seat) => seat.deviceIdentifier === deviceIdentifier,
      );

      if (!seatsIncludesClient && activeSeats.length >= license.seats) {
        return NextResponse.json(
          {
            result: {
              timestamp: new Date(),
              valid: false,
              details: 'License seat limit reached',
              code: RequestStatus.MAXIMUM_CONCURRENT_SEATS,
            },
          },
          {
            status: HttpStatus.FORBIDDEN,
          },
        );
      }
    }

    await prisma.heartbeat.upsert({
      where: {
        licenseId_deviceIdentifier: {
          licenseId: license.id,
          deviceIdentifier,
        },
      },
      update: {
        lastBeatAt: new Date(),
        ipAddress: getIp(),
      },
      create: {
        teamId: team.id,
        deviceIdentifier,
        lastBeatAt: new Date(),
        licenseId: license.id,
      },
    });

    const privateKey = team.keyPair?.privateKey!;

    const challengeResponse = challenge
      ? signChallenge(challenge, privateKey)
      : undefined;

    return NextResponse.json(
      {
        result: {
          timestamp: new Date(),
          valid: true,
          details: 'License heartbeat successful',
          code: RequestStatus.VALID,
        },
        challengeResponse,
      },
      {
        status: HttpStatus.OK,
      },
    );
  } catch (error) {
    logger.error(
      "Error occurred in '(external)/v1/license/[slug]/heartbeat' route",
      error,
    );

    return NextResponse.json(
      {
        result: {
          timestamp: new Date(),
          valid: false,
          details: 'Internal server error',
          code: RequestStatus.INTERNAL_SERVER_ERROR,
        },
      },
      {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      },
    );
  }
}
