import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma_stundenliste__: PrismaClient | undefined;
}

export function getPrisma() {
  if (!global.__prisma_stundenliste__) {
    global.__prisma_stundenliste__ = new PrismaClient();
  }
  return global.__prisma_stundenliste__;
}
