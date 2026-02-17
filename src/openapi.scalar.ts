import {
  getHtmlDocument,
  type HtmlRenderingConfiguration,
} from "@scalar/core/libs/html-rendering";
import { html } from "h3";

export type ApiReferenceConfiguration = Partial<HtmlRenderingConfiguration>;

export function apiReference(
  configuration: ApiReferenceConfiguration,
  customTheme?: string,
) {
  return html(getHtmlDocument(configuration, customTheme));
}
