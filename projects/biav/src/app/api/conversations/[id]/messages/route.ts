import { NextRequest, NextResponse } from 'next/server'
import { getMessages } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const messages = getMessages(params.id)
  return NextResponse.json(messages)
}
