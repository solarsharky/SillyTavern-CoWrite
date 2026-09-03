import { cloneJson } from './clone';
import { upgradeBuiltinPrompts } from '../domain/defaults';
import { TemplateSchema, type ContentItem, type CowriteTemplate, type GenerationContext } from '../domain/schema';

export function prepareTemplateForGeneration(source: CowriteTemplate, context: GenerationContext, content?: ContentItem): CowriteTemplate {
  const upgraded = upgradeBuiltinPrompts(source);
  let contentGuidance = content ? content.guidance : source.contentGuidance;
  // A clicked content item can still come from the pre-upgrade template.
  if (content && source.contentItems.some((item) => item.id === content.id && item.guidance === content.guidance)) {
    contentGuidance = upgraded.contentItems.find((item) => item.id === content.id)?.guidance ?? contentGuidance;
  }
  return TemplateSchema.parse({
    ...upgraded,
    contentGuidance,
    contentTitle: content ? content.name : source.contentTitle,
    context: cloneJson(context),
    connectionId: 'default',
  });
}
