import {
  AnyApiReferenceConfiguration,
  renderApiReference,
} from "@scalar/client-side-rendering";
import { html } from "h3";

export {
  renderApiReference,
  type AnyApiReferenceConfiguration,
} from "@scalar/client-side-rendering";

/**
 * Renders a Scalar API reference UI as an HTML string.
 *
 * @experimental This API is experimental and may change in future versions.
 *
 * @param options.config - Scalar API reference configuration.
 * @param options.pageTitle - Page title. Defaults to "Scalar API Reference".
 * @param options.cdn - CDN URL for the standalone bundle. Defaults to jsDelivr.
 * @param customTheme - Custom CSS theme for the Scalar UI.
 */
export function apiReference(
  options: {
    /** The API reference configuration. */
    config: AnyApiReferenceConfiguration;
    /** Page title. Defaults to "Scalar API Reference". */
    pageTitle?: string;
    /** CDN URL for the standalone bundle. Defaults to jsDelivr. */
    cdn?: string;
  },
  customTheme?: string,
) {
  return html(renderApiReference(options, customTheme));
}
