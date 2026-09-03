import { cloneJson } from './clone';
import { upgradeBuiltinPrompts } from '../domain/defaults';
import { TemplateSchema, type ContentItem, type CowriteTemplate, type GenerationContext } from '../domain/schema';

export function prepareTemplateForGeneration(source: CowriteTemplate, context: GenerationContext, content?: ContentItem): CowriteTemplate {
  return TemplateSchema.parse({
    ...upgradeBuiltinPrompts(source),
    contentGuidance: content ? content.guidance : source.contentGuidance,
    contentTitle: content ? content.name : source.contentTitle,
    context: cloneJson(context),
    connectionId: 'default',
  });
}
