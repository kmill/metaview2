# channel.py
# support for pushing updates through channels

import time

import logging
logger = logging.getLogger(__name__)

class Channel(object) :
    def __init__(self, channel_id, user, ttl=60*2) :
        self.channel_id = channel_id
        self.user = user
        self.callbacks = set()
        self.message_queue = []
        self.last_used = time.time()
        self.ttl = ttl
    def maybe_dequeue(self) :
        if self.message_queue and self.callbacks :
            messages = self.message_queue
            self.message_queue = []
            handled = False
            while self.callbacks and not handled :
                callback = self.callbacks.pop()
                handled = callback(messages)
            if handled :
                self.last_used = time.time()
            else :
                self.message_queue = messages
    def add_messages(self, messages) :
        for message in messages :
            if message.appropriate_for(self.user) :
                self.message_queue.append(message)
        self.maybe_dequeue()
    def add_callback(self, callback) :
        self.callbacks.add(callback)
        self.maybe_dequeue()
    def remove_callback(self, callback) :
        self.callbacks.remove(callback)
    def is_expired(self) :
        return time.time() - self.last_used > self.ttl
    def verify(self, user) :
        return self.user.id == user.id

class ChannelSet(object) :
    def __init__(self) :
        self.channels = dict()
        self.next_channel_id = 1
    def add_channel(self, user) :
        i = self.next_channel_id
        self.next_channel_id += 1
        c = Channel(i, user)
        self.channels[i] = c
        logger.info("Added channel_id=%s", i)
        return c
    def get_channel(self, i) :
        return self.channels.get(i, None)
    def broadcast(self, messages) :
        for i, channel in self.channels.iteritems() :
            channel.add_messages(messages)
        to_remove = set()
        for i, channel in self.channels.iteritems() :
            if channel.is_expired() :
                to_remove.add(i)
        for i in to_remove :
            del self.channels[i]

class Message(object) :
    def appropriate_for(self, user) :
        raise NotImplemented
    def serialize(self) :
        raise NotImplemented

class TextMessage(object) :
    def __init__(self, user, m) :
        self.user = user
        self.m = m
    def appropriate_for(self, user) :
        return True
    def serialize(self) :
        return {"type" : "TextMessage",
                "args" : {"user" : self.user,
                          "m" : self.m}}
