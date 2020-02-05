import cleanStack from 'clean-stack';
import newGithubIssueUrl from 'new-github-issue-url';

import { createCall, getCurrentCall } from '@/lib/cli-args';
import { ENV } from '@/lib/utils';
import { Item, workflowList } from '@/lib/workflow';
import { notification } from '@/lib/workflow/notification';

import logger from './logger';

/**
 * Error constants.
 */
export const Errors = {
  InvalidArgument: 'Invalid argument error',
  InvalidSetting: 'Invalid setting error',
  InvalidNodeJS: 'Invalid Node.js version error',
  InvalidFilePath: 'Invalid file path error',
  InvalidAPIResponse: 'Invalid API response error',
  ParserError: 'Parser error',
  TodoistAPIError: 'Todoist API error',
  External: 'External error',
};

interface AlfredErrorOptions {
  isSafe?: boolean;
  title?: string;
  error?: Error;
}

export class AlfredError extends Error {
  commonType: string;
  description: string;
  isSafe?: boolean;
  title: string;
  constructor(
    commonType: string,
    description: string,
    options?: AlfredErrorOptions
  ) {
    super(description);

    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain

    this.commonType = this.name = commonType;
    this.description = this.message = description;
    this.title = options?.title ?? 'Oops, this is not supposed to happen';
    this.isSafe = options?.isSafe ?? false;
    if (options?.error?.name) this.name += ` (${options.error.name})`;

    Error.stackTraceLimit = 50;
    Error.captureStackTrace(options?.error ?? this, AlfredError);
  }
}

/**
 * Custom workflow error.
 *
 * @param error An `Error` object.
 * @param anonymize Strip personal information from log.
 * @returns A detailed error log.
 */
function errorDetail(error: Error | AlfredError): string {
  let call;
  try {
    call = getCurrentCall();
  } catch {
    call = {
      args: '<unknown>',
    };
  }
  const title = error instanceof AlfredError ? error.title : error.name;
  const description = error.message;

  return (
    [
      'ALFRED WORKFLOW TODOIST',
      '----------------------------------------',
      `title: ${title}`,
      `description: ${description}`,
      '',
      `os: macOS ${ENV.meta.osx}`,
      `query: ${call.args}`,
      `node.js: ${ENV.meta.nodejs}`,
      `alfred: ${ENV.meta.alfred}`,
      `workflow: ${ENV.workflow.version}`,
      `workflow-id: ${ENV.workflow.uid}`,
      // @ts-ignore: I can't think of a way for the stack property to be
      // undefined. I figured this a problem with type definitions.
      `\nStack: ${cleanStack(error.stack, { pretty: true })}`,
    ]
      .join('\n')
      // Hide token from log by default
      .replace(/[0-9a-fA-F]{40}/gm, '<token hidden>')
  );
}

function isUserFacingMethod(): boolean {
  let call;
  try {
    call = getCurrentCall();
  } catch {
    // Err on the side of caution.
    return true;
  }

  return (
    call.name === 'parse' ||
    call.name === 'read' ||
    call.name === 'readSettings'
  );
}

function createIssueLink(error: Error): string {
  return newGithubIssueUrl({
    user: 'moranje',
    repo: 'alfred-workflow-todoist',
    body: [
      '### Description',
      '',
      '<A clear and concise description of what the bug is.>',
      '',
      '### Steps to reproduce behavior',
      '',
      '<Please describe what you did here.>',
      '',
      '### Expected behavior',
      '',
      '<A clear and concise description of what you expected to happen.>',
      '',
      '### Error logs',
      '',
      errorDetail(error),
    ].join('\n'),
    title: error.stack?.split('\n')[0],
  });
}

function listProblem(error: AlfredError): void {
  if (isUserFacingMethod()) {
    return workflowList
      .clear()
      .addItem(
        new Item({
          arg: createCall({
            name: 'openUrl',
            args: 'https://github.com/moranje/alfred-workflow-todoist',
          }),
          title: error.title,
          subtitle: error.message,
          valid: true,
          text: {
            copy: `${error.name}: ${error.message}`,
          },
        })
      )
      .write();
  }

  return notification({
    subtitle: error.title,
    message: error.message,
    url: 'https://github.com/moranje/alfred-workflow-todoist',
  });
}

function listBug(error: Error): void {
  if (isUserFacingMethod()) {
    return workflowList
      .clear()
      .addItem(
        new Item({
          arg: createCall({ name: 'openUrl', args: createIssueLink(error) }),
          title: 'Oops, something is not right',
          subtitle: 'Create a bug report',
          valid: true,
          quicklookurl: createIssueLink(error),
        })
      )
      .write();
  }

  return notification({
    subtitle: 'Oops, something is not right',
    message: 'Click to create a bug report',
    url: createIssueLink(error),
  });
}

function unrecoverableError(error: Error): void {
  logger().error(error);

  return listBug(error);
}

/**
 * Error management. Should only be called in toplevel error handlers. Doesn't
 * interrupt the flow of the application.
 *
 * @param error Any error.
 * @returns Void.
 */
export function funnelError(error: Error): void {
  if (error instanceof AlfredError && error.isSafe) {
    logger().error(error);

    return listProblem(error);
  }

  return unrecoverableError(error);
}

/**
 * Error listeners.
 */
// NOTE (any): Doesn't match call signature but will be an error
process.once('unhandledRejection', funnelError as any);
process.once('uncaughtException', funnelError);
