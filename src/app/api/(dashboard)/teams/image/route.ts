import prisma from '@/lib/database/prisma';
import { getSession } from '@/lib/utils/auth';
import { getLanguage, getSelectedTeam } from '@/lib/utils/header-helpers';
import { logger } from '@/lib/utils/logger';
import { ErrorResponse } from '@/types/common-api-types';
import { HttpStatus } from '@/types/http-status';
import {
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  PutObjectCommand,
  PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { getTranslations } from 'next-intl/server';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

const s3Client = new S3Client({
  endpoint: process.env.CONTABO_STORAGE_ENDPOINT,
  region: 'default',
  credentials: {
    accessKeyId: process.env.CONTABO_ACCESS_KEY!,
    secretAccessKey: process.env.CONTABO_SECRET_KEY!,
  },
  forcePathStyle: true,
});

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_DIMENSION = 600; // pixels

export type ITeamsImageSetSuccessResponse = {
  url: string;
};

export type ITeamsImageSetResponse =
  | ITeamsImageSetSuccessResponse
  | ErrorResponse;

export async function POST(request: NextRequest) {
  const t = await getTranslations({ locale: getLanguage() });

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        {
          message: t('validation.bad_request'),
        },
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          message: t('validation.file_too_large'),
        },
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          message: t('validation.invalid_file_type'),
        },
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const selectedTeam = getSelectedTeam();

    if (!selectedTeam) {
      return NextResponse.json(
        {
          message: t('validation.team_not_found'),
        },
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const session = await getSession({
      user: {
        include: {
          teams: {
            where: {
              id: selectedTeam,
              deletedAt: null,
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

    const team = session.user.teams[0];

    const fileBuffer = await file.arrayBuffer();
    let processedImageBuffer: Buffer;
    try {
      processedImageBuffer = await sharp(Buffer.from(fileBuffer))
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: 80 })
        .toBuffer();
    } catch (error) {
      logger.error('Error occurred while resizing image', error);
      return NextResponse.json(
        {
          message: t('general.server_error'),
        },
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    }

    if (team.imageUrl) {
      const imageUrlParts = team.imageUrl.split('/');
      const fileKey = imageUrlParts[imageUrlParts.length - 1];

      const deleteParams = {
        Bucket: process.env.CONTABO_BUCKET_NAME!,
        Key: `teams/${fileKey}`,
      } as DeleteObjectCommandInput;

      await s3Client.send(new DeleteObjectCommand(deleteParams));
    }

    const imageUuid = randomUUID();

    const fileKey = `teams/${imageUuid}.${file.type.split('/')[1]}`;
    const uploadParams = {
      Bucket: process.env.CONTABO_BUCKET_NAME!,
      Key: fileKey,
      Body: processedImageBuffer,
      ContentType: file.type,
    } as PutObjectCommandInput;

    await s3Client.send(new PutObjectCommand(uploadParams));

    const imageUrl = `${process.env.CONTABO_PUBLIC_ENDPOINT}:${process.env.CONTABO_BUCKET_NAME}/${fileKey}`;

    await prisma.team.update({
      where: {
        id: team.id,
      },
      data: {
        imageUrl,
      },
    });

    return NextResponse.json(
      {
        url: imageUrl,
      },
      { status: HttpStatus.OK },
    );
  } catch (error) {
    logger.error("Error occurred in 'teams/image' route", error);
    return NextResponse.json(
      {
        message: t('general.server_error'),
      },
      { status: HttpStatus.INTERNAL_SERVER_ERROR },
    );
  }
}
