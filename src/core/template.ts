import { cloneJson } from './clone';
import { TemplateSchema, type ContentItem, type CowriteTemplate, type GenerationContext } from '../domain/schema';

export function prepareTemplateForGeneration(source: CowriteTemplate, context: GenerationContext, content?: ContentItem): CowriteTemplate {
  return TemplateSchema.parse({
    ...cloneJson(source),
    contentGuidance: content ? content.guidance : source.contentGuidance,
    contentTitle: content ? content.name : source.contentTitle,
    context: cloneJson(context),
    connectionId: 'default',
  });
}
