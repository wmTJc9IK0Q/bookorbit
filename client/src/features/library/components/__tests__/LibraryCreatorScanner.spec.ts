import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LibraryCreatorScanner from '../LibraryCreatorScanner.vue'

describe('LibraryCreatorScanner', () => {
  function mountComponent(props: Record<string, unknown> = {}) {
    return mount(LibraryCreatorScanner, {
      props: {
        organizationMode: 'book_per_folder',
        allowedFormats: [],
        excludePatterns: [],
        embedContent: false,
        ...props,
      },
    })
  }

  it('renders the embed-content toggle and emits its update', async () => {
    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('Embed book content')

    const toggle = wrapper.find('[role="switch"]')
    expect(toggle.exists()).toBe(true)
    await toggle.trigger('click')
    expect(wrapper.emitted('update:embedContent')).toEqual([[true]])
  })

  it('reflects the enabled state and emits false when turned off', async () => {
    const wrapper = mountComponent({ embedContent: true })

    await wrapper.find('[role="switch"]').trigger('click')
    expect(wrapper.emitted('update:embedContent')).toEqual([[false]])
  })
})
