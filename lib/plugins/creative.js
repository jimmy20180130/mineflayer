const assert = require('assert')
const { Vec3 } = require('vec3')
const { sleep, onceWithCleanup } = require('../promise_utils')
const { once } = require('../promise_utils')

module.exports = inject

function inject(bot) {
  const Item = require('prismarine-item')(bot.registry)

  // these features only work when you are in creative mode.
  bot.creative = {
    setInventorySlot,
    flyTo,
    startFlying,
    stopFlying,
    clearSlot: slotNum => setInventorySlot(slotNum, null),
    clearInventory
  }

  const creativeSlotsUpdates = []

  // WARN: This method should not be called twice on the same slot before first promise succeeds
  async function setInventorySlot (slot, item, waitTimeout = 400) {
    assert(slot >= 0 && slot <= 44)

    if (Item.equal(bot.inventory.slots[slot], item, true)) return
    if (creativeSlotsUpdates[slot]) {
      throw new Error(`Setting slot ${slot} cancelled due to calling bot.creative.setInventorySlot(${slot}, ...) again`)
    }
    creativeSlotsUpdates[slot] = true
    bot._client.write('set_creative_slot', {
      slot,
      item: Item.toNotch(item)
    })

    if (bot.supportFeature('noAckOnCreateSetSlotPacket')) {
      // No ack
      bot._setSlot(slot, item)
      if (waitTimeout === 0) return // no wait
      // allow some time to see if server rejects
      return new Promise((resolve, reject) => {
        function updateSlot (oldItem, newItem) {
          if (newItem.itemId !== item.itemId) {
            creativeSlotsUpdates[slot] = false
            reject(Error('Server rejected'))
          }
        }
        bot.inventory.once(`updateSlot:${slot}`, updateSlot)
        setTimeout(() => {
          bot.inventory.off(`updateSlot:${slot}`, updateSlot)
          creativeSlotsUpdates[slot] = false
          resolve()
        }, waitTimeout)
      })
    }

    await onceWithCleanup(bot.inventory, `updateSlot:${slot}`, {
      timeout: 5000,
      checkCondition: (oldItem, newItem) => item === null ? newItem === null : newItem?.name === item.name && newItem?.count === item.count && newItem?.metadata === item.metadata
    })
    creativeSlotsUpdates[slot] = false
  }

  async function clearInventory() {
    return Promise.all(bot.inventory.slots.filter(item => item).map(item => setInventorySlot(item.slot, null)))
  }

  let normalGravity = null

  // straight line, so make sure there's a clear path.
  async function flyTo(destination, speed) {
    startFlying()

    // if destination's x and z are the same as bot's, set them to bot's to avoid division by zero
    if (destination.x === bot.entity.position.x && destination.z === bot.entity.position.z) {
      bot.entity.position.set(destination.x, destination.y, destination.z)
      return
    }

    // if the destination is near the bot, just set the bot's position to the destination
    if (bot.entity.position.distanceTo(destination) < 3) {
      bot.entity.position.set(destination.x, destination.y, destination.z)
      return
    }

    //bot.physics.gravity = 0
    const maxAcceptDistanceToDes = 4
    const timeout = 30000

    while (bot.entity.position.distanceTo(destination) > maxAcceptDistanceToDes) {
      const startTime = Date.now()

      const direction = destination.minus(bot.entity.position);
      const normalizedDirection = direction.normalize();
      const movement = normalizedDirection.scaled(speed);

      bot.entity.position = bot.entity.position.plus(movement)
      await bot.waitForTicks(1);

      const timeSpent = Date.now() - startTime;
      if (timeSpent > timeout) {
        bot.chat('/homes start');
        await new Promise(resolve => setTimeout(resolve, 3000));
        break;
      }
    }

    bot.entity.position.set(destination.x, destination.y, destination.z)
  }

  function startFlying() {
    if (normalGravity == null) normalGravity = bot.physics.gravity
    bot.physics.gravity = 0
    bot._client.write("abilities", {
      flags: 2
    })
  }

  function stopFlying() {
    bot.physics.gravity = normalGravity
    bot._client.write("abilities", {
      flags: 0
    })
  }
}
