import WiseSpineLayoutComponent from './WiseSpineLayoutComponent';

export default function getLayoutTemplateModule({ servicesManager, extensionManager, commandsManager, hotkeysManager }) {
  function WiseSpineLayoutWithServices(props) {
    return WiseSpineLayoutComponent({
      servicesManager,
      extensionManager,
      commandsManager,
      hotkeysManager,
      ...props,
    });
  }

  return [
    {
      id: 'wiseSpineLayout',
      name: 'wiseSpineLayout',
      component: WiseSpineLayoutWithServices,
    },
  ];
}
