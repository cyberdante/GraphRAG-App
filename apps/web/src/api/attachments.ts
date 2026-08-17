import type { AttachmentInfo } from '@ragstone/shared';

/**
 * One file in the composer, and what has become of it.
 *
 * The composer used to hold `File` objects and send their *names*: the bytes
 * were read into memory, shown as a chip, and dropped. The chip was the whole
 * feature. So a status is not decoration here — it is the difference between an
 * attachment that reached the answer and one that only looked like it had.
 */
export type AttachmentState =
  | { status: 'uploading'; name: string; localId: string }
  | { status: 'ready'; name: string; localId: string; id: string; characters: number }
  | { status: 'rejected'; name: string; localId: string; detail: string };

/** Distinguishes two files of the same name before the server has seen either. */
let counter = 0;
export const nextLocalId = (): string => `local-${(counter += 1)}`;

/**
 * Uploads files and reports on each one.
 *
 * The service answers 200 with a per-file status rather than a 4xx, because
 * attaching four documents where one is a video should attach three and say why
 * the fourth did not. A transport failure is different — nothing arrived — so
 * every file in the batch is marked rejected with the reason.
 */
export async function uploadAttachments(
  files: readonly { file: File; localId: string }[],
  baseUrl = '',
): Promise<AttachmentState[]> {
  const body = new FormData();
  for (const { file } of files) body.append('files', file, file.name);

  try {
    const response = await fetch(`${baseUrl}/api/attachments`, { method: 'POST', body });

    if (!response.ok) {
      return files.map(({ file, localId }) => ({
        status: 'rejected' as const,
        name: file.name,
        localId,
        detail: `The service returned ${response.status}.`,
      }));
    }

    const reported = (await response.json()) as AttachmentInfo[];

    // Paired by position: the service reports one entry per file in the order
    // they were sent, and a rejected entry has no id to match on.
    return files.map(({ file, localId }, index) => {
      const info = reported[index];
      if (!info || info.status === 'rejected') {
        return {
          status: 'rejected' as const,
          name: file.name,
          localId,
          detail: info?.detail ?? 'The service did not report on this file.',
        };
      }
      return {
        status: 'ready' as const,
        name: info.name,
        localId,
        id: info.id,
        characters: info.characters,
      };
    });
  } catch {
    return files.map(({ file, localId }) => ({
      status: 'rejected' as const,
      name: file.name,
      localId,
      detail: 'Could not reach the service.',
    }));
  }
}

/** The ids a query should carry: only what actually arrived. */
export function readyIds(attachments: readonly AttachmentState[]): string[] {
  return attachments.flatMap((item) => (item.status === 'ready' ? [item.id] : []));
}
