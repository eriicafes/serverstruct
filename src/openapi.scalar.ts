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
  return html(
    getHtmlDocument(
      {
        // @ts-expect-error
        _integration: "serverstruct",
        ...configuration,
      },
      customTheme,
    ),
  );
}
